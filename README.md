# Lithopainter

**[Try it live](https://parttimenerd.github.io/lithopainter/)**

A browser-based tool for turning photos into circular lithopane STL files ready for 3D printing. Supports webcam capture, image upload, background removal, and real-time preview with adjustable image processing parameters.

## Features

- **Webcam capture** with live preview and freeze-to-generate workflow
- **Image upload** via file picker, drag & drop, paste, or URL
- **Circle crop** with draggable/resizable overlay
- **Face detection** — one-shot auto-crop to detected face using MediaPipe BlazeFace (press `F`)
- **Face tracking** — real-time face tracking that keeps the crop circle locked to your face in live mode, with position-only (`T`) and position+resize (`Shift+T`) modes
- **Background removal** with multiple AI models (U2NetP, U2Net, ISNet, Silueta, etc.) — runs on full image before cropping for better accuracy
- **Image adjustments** — brightness, contrast, gamma, shadows, highlights, edge enhance, local contrast, auto levels — re-applied instantly from cached source without re-running BG removal
- **Mirror mode** for printing face-down lithopanes
- **Interactive 3D preview** with orbit controls (rotate, zoom, pan) and backlit PLA shader simulation
- **Configurable print parameters** — diameter, layer height, initial layer, number of layers, nozzle width
- **Alignment notches** with adjustable count, radius, and height
- **STL export** for direct 3D printing
- **Live/continuous mode** for real-time webcam-to-mesh generation
- **Settings persistence** via localStorage

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Freeze / unfreeze webcam |
| `F` | Detect face and auto-crop |
| `T` | Toggle face position tracking |
| `Shift+T` | Toggle face position + resize tracking |

## Usage

```bash
npm install --legacy-peer-deps
npm run dev
```

## License

This project is licensed under the [GNU General Public License v2.0](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html).
