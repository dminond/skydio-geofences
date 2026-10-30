# Skydio Geofence Builder

A static, single-page tool for drawing custom geofences on a map and exporting them as a
GeoJSON file in the format used by Skydio Airspace Manager (see
[`examples/example_boundary.geojson`](examples/example_boundary.geojson)).

## Usage

1. Search for a site (address, place name, or `lat, lng`), or pan/zoom the satellite map.
2. Draw zones with the **polygon** or **rectangle** tool (top-left of the map). For polygons,
   click to add points and click the first point to close the shape.
3. Set each zone's properties in the sidebar:
   - **name**
   - **keepOut** – Keep-out (`true`) or Keep-in (`false`)
   - **floor** / **ceiling** – altitudes in meters (feet shown for reference)
   - **floorFrame** / **ceilingFrame** – altitude reference (`AGL` or `MSL`)
4. Set the file **title** and **description**, then **Download .geojson** or **Copy JSON**.

Other features:
- Edit, move, rotate, or delete shapes with the map's edit tools.
- **Import** an existing `.geojson` to edit it (replace or append).
- "Defaults for new zones" sets the properties applied to newly drawn shapes.
- Work is autosaved in the browser (localStorage) so a refresh won't lose it.

## Output format

```json
{
  "type": "FeatureCollection",
  "title": "...",
  "description": "...",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "Keep-Out Zone",
        "keepOut": true,
        "floor": 0.0,
        "ceiling": 120.0,
        "floorFrame": "AGL",
        "ceilingFrame": "AGL"
      },
      "geometry": {
        "coordinates": [[[lng, lat], ..., [lng, lat]]],
        "type": "Polygon"
      }
    }
  ]
}
```

Coordinates are `[longitude, latitude]` and each ring is closed (first point repeated last).
Importing the example file and exporting it produces an identical file.

## Running locally

No build step. Serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000.

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` deploys the site on every push to `main` (or manually via
**Actions → Deploy to GitHub Pages → Run workflow**). One-time setup: in the repo go to
**Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
