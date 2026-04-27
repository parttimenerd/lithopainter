# Lithopainter

**[Try it live](https://parttimenerd.github.io/lithopainter/)**

A browser-based tool for turning photos into circular lithopane STL files ready for 3D printing. Supports webcam capture, image upload, background removal, and real-time preview with adjustable image processing parameters.

## Features

- **Webcam capture** with live preview and freeze-to-generate workflow
- **Image upload** via file picker, drag & drop, paste, or URL
- **Circle crop** with draggable/resizable overlay
- **Background removal** with multiple AI models (U2NetP, U2Net, ISNet, Silueta, etc.) — runs on full image before cropping for better accuracy
- **Image adjustments** — brightness, contrast, gamma, shadows, highlights, edge enhance, local contrast, auto levels — re-applied instantly from cached source without re-running BG removal
- **Mirror mode** for printing face-down lithopanes
- **Interactive 3D preview** with orbit controls (rotate, zoom, pan) and backlit PLA shader simulation
- **Configurable print parameters** — diameter, layer height, initial layer, number of layers, nozzle width
- **Alignment notches** with adjustable count, radius, and height
- **STL export** for direct 3D printing
- **Live/continuous mode** for real-time webcam-to-mesh generation
- **Settings persistence** via localStorage

## Usage

```bash
npm install --legacy-peer-deps
npm run dev
```

## License

This project is licensed under the [GNU General Public License v2.0](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html).
