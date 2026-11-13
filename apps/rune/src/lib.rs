//! Foundation's board drawn by Rune, for the browser and the desktop app's webview (WebGPU).
//!
//! It runs beside the web renderer, never instead of it: Settings → Renderer picks which one
//! draws the grid, and the web one is the default. The client keeps the store, sync and the
//! camera; this crate draws what it's handed (`scene`) and reports what the person did
//! (`bridge`). `apps/client/src/rune/` is the other half.

pub mod bridge;
pub mod scene;
pub mod view;

#[cfg(target_arch = "wasm32")]
mod web {
    use std::cell::RefCell;

    use rune::{App, AppHandle, AppSpec, ImageCache, Live, Waker, WindowOptions};
    use wasm_bindgen::prelude::*;

    use crate::bridge;
    use crate::scene::{SCENE_VERSION, Scene};
    use crate::view::{Board, view};

    thread_local! {
        static CAMERA: (Live<[f32; 2]>, Live<f32>) = (Live::new([0.0, 0.0]), Live::new(0.5));
        static HANDLE: RefCell<Option<AppHandle<Board>>> = const { RefCell::new(None) };
    }

    fn init() -> Board {
        CAMERA.with(|(pan, zoom)| Board::new(pan.clone(), zoom.clone()))
    }

    fn setup(board: &mut Board, waker: Waker) {
        board.cache = Some(ImageCache::new(waker));
    }

    fn update(f: impl FnOnce(&mut Board) + Send + 'static) {
        HANDLE.with(|h| {
            if let Some(handle) = h.borrow().as_ref() {
                handle.update(move |board, _| f(board));
            }
        });
    }

    /// The scene shape this module reads; the client checks it before mounting.
    #[wasm_bindgen(js_name = sceneVersion)]
    pub fn scene_version() -> u32 {
        SCENE_VERSION
    }

    /// Draw onto `<canvas id>`, covering the viewport; `on_event` hears each `bridge::Event` as
    /// JSON. `transparent` asks for a see-through canvas, so the paper under it shows.
    #[wasm_bindgen]
    pub fn mount(canvas_id: String, transparent: bool, on_event: js_sys::Function) -> Result<(), String> {
        bridge::set_sink(Some(Box::new(move |json| {
            let _ = on_event.call1(&JsValue::NULL, &JsValue::from_str(json));
        })));
        let spec = AppSpec { setup: Some(setup), ..AppSpec::new("Foundation", (1280.0, 800.0), init, view) };
        let app = App::new(spec).canvas_id(canvas_id).full_viewport().window_options(WindowOptions { transparent, ..WindowOptions::default() });
        HANDLE.with(|h| *h.borrow_mut() = Some(app.handle()));
        app.try_run()
    }

    /// The board as the store has it now (`scene::Scene`, as JSON).
    #[wasm_bindgen(js_name = setScene)]
    pub fn set_scene(json: String) -> Result<(), String> {
        let scene: Scene = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        update(move |board| board.set_scene(scene));
        Ok(())
    }

    /// The camera, every frame it moves: draws without re-running the view.
    #[wasm_bindgen(js_name = setCamera)]
    pub fn set_camera(x: f32, y: f32, scale: f32) {
        CAMERA.with(|(pan, zoom)| {
            pan.set([x, y]);
            zoom.set(scale);
        });
    }

    /// Open a note for writing (the client decides when: a double-click on a note already framed).
    #[wasm_bindgen(js_name = beginEdit)]
    pub fn begin_edit(id: String) {
        update(move |board| board.begin_edit(&id));
    }

    #[wasm_bindgen(js_name = endEdit)]
    pub fn end_edit() {
        update(|board| board.end_edit());
    }

    /// Stop drawing and give the canvas back (the engine was switched, or the board closed).
    #[wasm_bindgen]
    pub fn unmount() {
        HANDLE.with(|h| {
            if let Some(handle) = h.borrow_mut().take() {
                handle.quit();
            }
        });
        bridge::set_sink(None);
    }
}
