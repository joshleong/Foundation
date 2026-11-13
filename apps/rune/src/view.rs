//! The board, drawn: paper, the grid's frame and tracks, sections, empty cells and cards.
//!
//! The values here are the web renderer's (apps/client/src/App.css, DESIGN.md), named where
//! they come from, so a difference between the two engines is a bug in one of them. The camera
//! is two live values the client drives (it owns the springs, framing and keys for both
//! engines): a pan or zoom draws without re-running this view.

use std::collections::HashMap;

use rune::{Cursor, Cx, Drag, El, Family, Image, ImageCache, Key, KeyEvent, Live, Phase, TextEdit, TextStyle, Tx, col, el, row, text, text_input};

use crate::bridge::{Event, emit};
use crate::scene::{Card, Empty, Kind, Scene, Section, Tokens, color, tint};

// DESIGN.md §4: radii, nothing in between
const R_PAPER: f32 = 3.0;
const R_CARD: f32 = 5.0;
const R_PANE: f32 = 8.0;
const R_PILL: f32 = 999.0;
/// store.ts SECTION_HEADER
const SECTION_HEADER: f32 = 42.0;
/// a held card lifts 2.5 % (DESIGN.md §1.5)
const LIFT: f32 = 1.025;

const NAME: TextStyle = TextStyle::new(14.0, 600.0).tracking(-0.07);
const COORDS: TextStyle = TextStyle::new(10.0, 600.0).tracking(0.8).features("'tnum' 1");
const COUNT: TextStyle = TextStyle::new(10.5, 600.0).features("'tnum' 1");
const TRACK: TextStyle = TextStyle::new(15.0, 700.0).tracking(2.1).features("'tnum' 1");
const ADD: TextStyle = TextStyle::new(12.5, 600.0);
const NOTE: TextStyle = TextStyle::new(13.5, 400.0).lh(13.5 * 1.55);
const NOTE_EDIT: TextStyle = TextStyle::new(12.5, 400.0).family(Family::Mono).lh(12.5 * 1.6);
const TABLE_NAME: TextStyle = TextStyle::new(15.0, 650.0).tracking(-0.15);
const TABLE_HEAD: TextStyle = TextStyle::new(10.5, 600.0).tracking(0.84).features("'tnum' 1");
const CELL: TextStyle = TextStyle::new(13.5, 400.0);
const CELL_NUM: TextStyle = TextStyle::new(13.5, 400.0).features("'tnum' 1");
const CELL_ERR: TextStyle = TextStyle::new(11.5, 600.0).tracking(0.35);
// store.ts: a table's own measures
const CELL_W: f32 = 148.0;
const CELL_H: f32 = 40.0;
const HEADER_H: f32 = 52.0;
const ROWNUM_W: f32 = 44.0;
const COLHEAD_H: f32 = 32.0;
const AGENT: TextStyle = TextStyle::new(11.0, 600.0);

/// A card following the pointer, and where it has got to (world points from its resting place).
pub struct Held {
    pub id: String,
    pub dx: f32,
    pub dy: f32,
    pub moved: bool,
    /// let go: it waits where it was dropped until the store's answer arrives
    pub dropped: bool,
}

pub struct Board {
    pub scene: Scene,
    pub pan: Live<[f32; 2]>,
    pub zoom: Live<f32>,
    pub held: Option<Held>,
    /// the note being written, and its field
    pub editing: Option<String>,
    pub edit: TextEdit,
    pub cache: Option<ImageCache>,
    pub images: HashMap<String, Image>,
}

impl Board {
    pub fn new(pan: Live<[f32; 2]>, zoom: Live<f32>) -> Self {
        Board { scene: Scene::default(), pan, zoom, held: None, editing: None, edit: TextEdit::new(""), cache: None, images: HashMap::new() }
    }

    /// The store changed: take its board. A note being written keeps its own text (the field
    /// is ahead of the store), and a dropped card stops waiting.
    pub fn set_scene(&mut self, scene: Scene) {
        if self.held.as_ref().is_some_and(|h| h.dropped) {
            self.held = None;
        }
        if let Some(cache) = &self.cache {
            for card in scene.cards.iter().filter(|c| c.kind == Kind::Image && !c.src.is_empty()) {
                self.images.entry(card.src.clone()).or_insert_with(|| cache.url(&card.src, card.w, 1.0));
            }
            self.images.retain(|src, _| scene.cards.iter().any(|c| &c.src == src));
        }
        if let Some(id) = &self.editing
            && !scene.cards.iter().any(|c| &c.id == id)
        {
            self.editing = None;
        }
        self.scene = scene;
    }

    pub fn begin_edit(&mut self, id: &str) {
        let Some(card) = self.scene.cards.iter().find(|c| c.id == id && c.kind == Kind::Note) else { return };
        if self.scene.read_only {
            return;
        }
        self.edit = TextEdit::new(card.text.clone());
        self.edit.focused = true;
        self.editing = Some(id.to_owned());
        emit(Event::Edit { id: Some(id) });
    }

    pub fn end_edit(&mut self) {
        if self.editing.take().is_some() {
            self.edit.focused = false;
            emit(Event::Edit { id: None });
        }
    }
}

pub fn view(b: &Board, _: &mut Cx<Board>) -> El {
    let sc = &b.scene;
    let t = &sc.tokens;
    let v = &sc.view;

    let mut world = el().key("world").absolute(-v.left, -v.top).size(sc.grid.w.max(1.0), sc.grid.h.max(1.0)).origin(0.0, 0.0).live_offset(&b.pan).live_scale(&b.zoom);
    world = world.child(grid_chrome(sc));
    for e in &sc.empties {
        world = world.child(empty_cell(e, t, sc.read_only));
    }
    for s in &sc.sections {
        world = world.child(section(s, t));
    }
    // the held card goes last, so it's over everything it passes
    let held = b.held.as_ref().map(|h| h.id.as_str());
    for c in sc.cards.iter().filter(|c| Some(c.id.as_str()) != held) {
        world = world.child(card(c, b));
    }
    if let Some(c) = held.and_then(|id| sc.cards.iter().find(|c| c.id == id)) {
        world = world.child(card(c, b));
    }

    // the cards stop where the floor is (the top bar, an open pane), cut clean
    let clip = el().key("floor").pin(Some(v.left), Some(v.top), Some(v.right), Some(0.0)).clip_rounded(0.0).child(world);
    let mut root = el().key("board").w_full().h_full().child(clip);
    if sc.paper {
        root = root.fill(color(t.void));
    }
    root
}

/// The frame round the whole grid, the track lines where they divide sections, and the
/// spreadsheet labels above and beside it.
fn grid_chrome(sc: &Scene) -> El {
    let t = &sc.tokens;
    let g = &sc.grid;
    let mut chrome = el().key("grid").absolute(0.0, 0.0).size(g.w.max(1.0), g.h.max(1.0)).inert();
    chrome = chrome.child(el().key("frame").absolute(0.0, 0.0).size(g.w, g.h).radius(R_PANE).border(1.5, tint(t.frost, 14.0)));
    for (i, l) in g.lines.iter().enumerate() {
        let (w, h) = if l.vertical { (1.5, l.len) } else { (l.len, 1.5) };
        chrome = chrome.child(el().key(format!("line-{i}")).absolute(l.x, l.y).size(w, h).fill(tint(t.frost, 10.0)));
    }
    let label = |s: &str| text(s.to_owned()).font(TRACK).color(tint(t.frost, 30.0));
    for (i, c) in g.cols.iter().enumerate() {
        chrome = chrome.child(el().key(format!("col-{i}")).absolute(c.at, -46.0).size(c.len, 34.0).center().child(label(&c.label)));
    }
    for (i, r) in g.rows.iter().enumerate() {
        chrome = chrome.child(el().key(format!("row-{i}")).absolute(-46.0, r.at).size(34.0, r.len).center().child(label(&r.label)));
    }
    chrome
}

/// An empty cell: a dashed target with its coordinates, and "+ Section" once the pointer is on it.
fn empty_cell(e: &Empty, t: &Tokens, read_only: bool) -> El {
    let (c, r) = (e.c, e.r);
    let mut cell = col().key(format!("empty-{c}-{r}")).absolute(e.x, e.y).size(e.w, e.h).center().gap(10.0).radius(R_PANE)
        .border(2.0, tint(t.frost, 14.0)).border_dash(7.0, 5.0).hover_group()
        .child(text(e.label.clone()).font(TRACK).color(tint(t.frost, 18.0)));
    if !read_only {
        cell = cell.child(
            el().key("add").px(16.0).py(7.0).radius(R_PILL).fill(color(t.raise)).border(1.0, color(t.line_strong))
                .shadow(2.0, 8.0, tint(t.frost, 8.0)).group_opacity(0.0, 1.0).press_scale(0.97).cursor(Cursor::Pointer)
                .child(text("+ Section").font(ADD).color(color(t.mist)))
                .on_press(move |_: &mut Board| emit(Event::CreateSection { c, r })),
        );
    }
    cell
}

/// A section: paper on the desk, no bar; its name, coordinates and count sit on the paper.
fn section(s: &Section, t: &Tokens) -> El {
    let id = s.id.clone();
    let lift = if s.active { (6.0, 9.0, 14.0, 44.0) } else { (4.0, 5.0, 10.0, 30.0) };
    let header = row().key("header").absolute(0.0, 0.0).w_full().h(SECTION_HEADER).center_y().gap(8.0).pl(10.0).pr(8.0)
        .child(el().px(6.0).py(3.0).child(text(s.name.clone()).font(NAME).color(color(t.frost)).truncate()))
        .child(el().px(6.0).py(2.0).radius(R_PAPER).fill(tint(t.moss, 9.0)).child(text(s.coords.clone()).font(COORDS).color(color(t.moss))))
        .child(el().min_w(18.0).h(18.0).px(5.0).center().radius(R_PILL).fill(color(t.panel)).child(text(s.count.clone()).font(COUNT).color(color(t.mist))));
    el().key(format!("sec-{}", s.id)).absolute(s.x, s.y).size(s.w, s.h).radius(R_PANE)
        .fill(tint(t.raise, 72.0))
        .border(1.0, color(if s.active { t.dim } else { t.line_strong }))
        .shadow(1.0, 2.0, tint(t.frost, lift.0))
        .shadow(lift.2, lift.3, tint(t.frost, lift.1))
        .child(header)
        .on_press_tx(move |b: &mut Board, _: &mut Tx| {
            b.end_edit();
            emit(Event::Section { id: &id });
        })
}

/// A card at its place in its section, at the section's fit; lifted and following while held.
fn card(c: &Card, b: &Board) -> El {
    let t = &b.scene.tokens;
    let held = b.held.as_ref().filter(|h| h.id == c.id);
    let (dx, dy) = held.map_or((0.0, 0.0), |h| (h.dx, h.dy));
    let carried = held.is_some_and(|h| h.moved && !h.dropped);
    let editing = b.editing.as_deref() == Some(c.id.as_str());
    let bare_image = c.kind == Kind::Image && b.images.contains_key(&c.src);

    let mut frame = el().key(format!("card-{}", c.id)).absolute(c.x + dx, c.y + dy).size(c.w, c.h).origin(0.0, 0.0)
        .scale(c.s * if carried { LIFT } else { 1.0 }).radius(R_CARD).clip_rounded(R_CARD);
    // images rest bare; everything else is paper with a hairline (DESIGN.md §5 Card, Media card)
    if !bare_image {
        frame = frame.fill(color(if c.kind == Kind::Note { t.abyss } else { t.raise })).border(1.0, color(t.line));
        frame = if carried { frame.shadow(14.0, 44.0, tint(t.frost, 16.0)) } else { frame.shadow(1.0, 2.0, tint(t.frost, 5.0)) };
    }
    if c.active || editing {
        frame = frame.border(2.0, color(t.pulse));
    }
    frame = frame.child(match c.kind {
        Kind::Note if editing => note_field(b, t),
        Kind::Note => note(c, t),
        Kind::Table => table(c, t),
        Kind::Image if bare_image => el().w_full().h_full().pixels(b.images[&c.src].pixels()),
        // an image still on its way: its paper, until the pixels land
        Kind::Image => el().w_full().h_full().fill(color(t.panel)),
    });
    if !c.agent.is_empty() {
        frame = frame.child(
            el().key("by").absolute(8.0, c.h - 26.0).h(18.0).px(7.0).center().radius(R_PILL).fill(tint(t.agent, 12.0))
                .child(text(format!("✦ {}", c.agent)).font(AGENT).color(color(t.agent))),
        );
    }
    if editing {
        return frame;
    }
    let (id, x, y, read_only) = (c.id.clone(), c.x, c.y, b.scene.read_only);
    frame.cursor(Cursor::Grab).on_drag(move |b: &mut Board, d: &mut Drag, tx: &mut Tx| match d.phase {
        Phase::Down => {
            b.end_edit();
            emit(Event::Object { id: &id });
            b.held = Some(Held { id: id.clone(), dx: 0.0, dy: 0.0, moved: false, dropped: false });
        }
        Phase::Move => {
            let zoom = b.zoom.get().max(0.01);
            if let Some(h) = b.held.as_mut().filter(|h| h.id == id && !read_only) {
                h.moved |= d.dx.hypot(d.dy) > 4.0;
                if h.moved {
                    (h.dx, h.dy) = (d.dx / zoom, d.dy / zoom);
                    tx.instant();
                }
            }
        }
        Phase::Up => {
            let Some(h) = b.held.as_mut().filter(|h| h.id == id) else { return };
            if h.moved && !d.cancelled() {
                h.dropped = true;
                emit(Event::Move { id: &id, x: x + h.dx, y: y + h.dy });
            } else {
                b.held = None;
            }
        }
    })
}

/// A note at rest: its text on the card. (Markdown is drawn as typed for now: see the ledger.)
fn note(c: &Card, t: &Tokens) -> El {
    el().w_full().h_full().px(18.0).py(14.0).child(text(c.text.clone()).font(NOTE).color(color(t.frost)).wrap().w_full())
}

/// A note being written: Rune's own field, in the code face like the web editor. It starts
/// 42 px down, below where the card's bar sits. Each keystroke goes to the store as typed.
fn note_field(b: &Board, t: &Tokens) -> El {
    let field = text_input(&b.edit, NOTE_EDIT).key("note-edit").color(color(t.frost)).caret(color(t.pulse), tint(t.pulse, 24.0))
        .w_full().h_full()
        .on_edit(|b: &mut Board| &mut b.edit)
        .on_input_change(|b: &mut Board, _: &mut Tx| {
            if let Some(id) = &b.editing {
                emit(Event::Text { id, text: &b.edit.text });
            }
        })
        .on_input_key(|b: &mut Board, ev: &KeyEvent, _: &mut Tx| {
            // Esc, or ⌘↵ / Ctrl+Enter: back to the note at rest (nothing to save, nothing to revert)
            let done = ev.key == Key::Escape || (ev.key == Key::Enter && ev.mods.cmd);
            if done {
                b.end_edit();
            }
            done
        });
    el().w_full().h_full().px(18.0).pt(42.0).pb(14.0).child(field)
}

/// A column's spreadsheet name: A, B … Z, AA …
fn col_name(mut n: u32) -> String {
    let mut s = String::new();
    loop {
        s.insert(0, (b'A' + (n % 26) as u8) as char);
        if n < 26 {
            return s;
        }
        n = n / 26 - 1;
    }
}

/// A table at rest: its header, the column and row heads, the ruling and what each cell shows.
/// Pressed, it becomes the card in hand and the web's live sheet takes its place (cells,
/// formulas, ranges and menus are the web's until Rune has them).
fn table(c: &Card, t: &Tokens) -> El {
    let (cols, rows) = (c.cols as f32, c.rows as f32);
    let sheet_w = ROWNUM_W + cols * CELL_W;
    let top = HEADER_H + COLHEAD_H;
    let grip = col().gap(3.0).px(4.0).py(6.0).opacity(0.5)
        .children((0..3).map(|_| el().size(14.0, 2.0).radius(2.0).fill(color(t.dim))));
    let header = row().absolute(0.0, 0.0).size(sheet_w, HEADER_H).center_y().gap(10.0).pl(10.0).pr(14.0)
        .gradient(color(t.abyss), color(t.void))
        .child(grip)
        .child(el().px(6.0).py(4.0).child(text(c.name.clone()).font(TABLE_NAME).color(color(t.frost)).truncate()));
    let mut sheet = el().w_full().h_full().fill(color(t.raise)).child(header)
        // the heads' wells, then the ruling over them: one line a track, not a border a cell
        .child(el().absolute(0.0, HEADER_H).size(sheet_w, COLHEAD_H).fill(color(t.panel)))
        .child(el().absolute(0.0, top).size(ROWNUM_W, rows * CELL_H).fill(color(t.panel)))
        .child(el().absolute(0.0, HEADER_H - 1.0).size(sheet_w, 1.0).fill(color(t.line)))
        .child(el().absolute(0.0, top - 1.0).size(sheet_w, 1.0).fill(color(t.line_strong)))
        .child(el().absolute(ROWNUM_W - 1.0, HEADER_H).size(1.0, COLHEAD_H + rows * CELL_H).fill(color(t.line_strong)));
    for i in 0..c.cols {
        let x = ROWNUM_W + i as f32 * CELL_W;
        sheet = sheet
            .child(el().key(format!("ch-{i}")).absolute(x, HEADER_H).size(CELL_W, COLHEAD_H).center().child(text(col_name(i)).font(TABLE_HEAD).color(color(t.dim))))
            .child(el().key(format!("cl-{i}")).absolute(x + CELL_W - 1.0, HEADER_H).size(1.0, COLHEAD_H + rows * CELL_H).fill(color(t.line)));
    }
    for i in 0..c.rows {
        let y = top + i as f32 * CELL_H;
        sheet = sheet
            .child(el().key(format!("rn-{i}")).absolute(0.0, y).size(ROWNUM_W, CELL_H).center().child(text((i + 1).to_string()).font(TABLE_HEAD).color(color(t.dim))))
            .child(el().key(format!("rl-{i}")).absolute(0.0, y + CELL_H - 1.0).size(sheet_w, 1.0).fill(color(t.line)));
    }
    for cell in &c.cells {
        let (x, y) = (ROWNUM_W + cell.c as f32 * CELL_W, top + cell.r as f32 * CELL_H);
        let label = text(cell.t.clone()).truncate();
        let label = if cell.e {
            label.font(CELL_ERR).color(color(t.bad))
        } else {
            label.font(if cell.n { CELL_NUM } else { CELL }).color(color(t.frost))
        };
        // numbers sit at the left like text, in tabular figures: what the web table draws (its
        // `.cell.num` asks for the right, but the text's own box fills the cell)
        let slot = row().key(format!("c-{}-{}", cell.c, cell.r)).absolute(x, y).size(CELL_W - 1.0, CELL_H - 1.0).center_y().px(12.0);
        sheet = sheet.child(slot.child(label));
    }
    sheet
}
