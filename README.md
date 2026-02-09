# PSAT Web Version

This is the web-based version of the Point Cloud Segmentation Annotation Tool (PSAT). It enables smooth visualization and basic component annotation of large point clouds directly in the browser.

## 🛠 Technology Stack

- **Framework**: [React](https://reactjs.org/) (with Vite for fast development)
- **3D Engine**: [Three.js](https://threejs.org/)
- **Data Loading**: [loaders.gl](https://loaders.gl/) (focused on `.las` and `.laz` support)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Styling**: Vanilla CSS

## 📋 Prerequisites

- **Node.js**: v18 or later (v20+ recommended)
- **npm**: v9 or later

## 🚀 Setup & Run

1.  Navigate to the `web` directory:
    ```bash
    cd web
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Start the development server:
    ```bash
    npm run dev
    ```

4.  Open your browser at `http://localhost:5173`.

## 🏗 Development

- **Layout**: The main layout is defined in `src/App.jsx`.
- **UI Components**: Simple UI components are used for controls and lists.
- **Three.js Scene**: Look into `src/App.jsx` for the Three.js initialization and point cloud loading logic.

## 📦 Git Submodule Management

This directory is a Git submodule. When working with it:

- **Updating in main repo**: If you make changes inside `web/` and commit/push them to the `PSAT-web` repository, you must also go back to the root `PSAT` directory and commit the reference change.
- **Cloning with submodules**:
  ```bash
  git clone --recursive <main-repo-url>
  ```
- **Pulling changes**:
  ```bash
  git pull origin master
  ```
  And then update submodules:
  ```bash
  git submodule update --init --recursive
  ```

## ✨ Features

- **High Performance**: Renders hundreds of thousands of points smoothly using `loaders.gl`.
- **Flexible Viewing**: Toggle between RGB, Classification, and Instance views.
- **Component Annotation**: Click to add components, adjust them with keyboard nudges, and export as JSON.
- **Local privacy**: All processing happens in your browser; no data is uploaded to a server.

## ⚠️ Limitations (Compared to Desktop Qt)
- No polygon/box/lasso selection for per-point labeling.
- No per-point class/instance editing.
- No LAZ/LAS write-back from the browser.
- No category/instance visibility panels.

## 📁 Data Formats

### Input
- **Point clouds**: `.las` / `.laz` files.
- **Metadata**: Matching `.json` file (must be selected together with the point cloud due to browser security).
- **ExtraBytes**: Support for `instance` (uint32) and `category` (uint16) extra bytes in LAS/LAZ.

### Output
- **JSON**: Contains metadata and component points. Does **not** include point-level labels.
