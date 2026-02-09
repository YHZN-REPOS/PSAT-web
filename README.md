# PSAT Web Version

This is a pure frontend implementation of PSAT using React, Three.js, and loaders.gl.

## Prerequisites

- Node.js (v18+)
- npm

## Setup & Run

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

## Features

-   Load local `.las` / `.laz` files; matching `.json` metadata is loaded when included in the same selection or folder.
-   Visualize point clouds in 3D (RGB / Class / Instance view).
-   Component annotation (add/edit/delete, keyboard nudge).
-   JSON export/import for metadata + components (no per-point labels).

## Limitations (Compared to Desktop Qt)
-   No polygon/box/lasso selection for per-point labeling.
-   No per-point class/instance editing.
-   No LAZ/LAS write-back from the browser.
-   No category/instance visibility panels.

## Data Formats
**Input**
-   Point cloud files: `.las/.laz`
-   Optional matching JSON (same basename, `.json`)
-   JSON may include: `categories` or `categorys` (per-point class array, length = point count)
-   JSON may include: `instances` (per-point instance array, length = point count)
-   JSON may include: `voltage_level`, `tower_type1`/`tower_type`, `tower_type2`/`tower_shape`, `transmission_type`, `num_circuit`
-   JSON may include: `components`, `small_tower_coord`, `large_tower_coord`
-   Note: the Web viewer reads standard `classification` and ExtraBytes `instance` (uint32) / `category` (uint16) when present
-   Note: due to browser restrictions, a matching `.json` is only loaded if it is included in the file selection or folder

**Output**
-   Exported JSON contains metadata + components only (no per-point labels).
