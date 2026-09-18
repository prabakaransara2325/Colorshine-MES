# Colorshine MES V2 v0.9.9 – Plant Stock Performance + Compact UX

Screen 6109 Plant Stock Report is optimized for large inventory volumes.

Changes:
- Server-side paging: default 200 rows; selectable 100 / 200 / 500.
- Full 8,692+ row dataset is no longer sent/rendered on initial screen load.
- Loading overlay gives immediate feedback while the current page is being retrieved.
- Plant Stock KPI tiles reduced to a compact six-cell management strip.
- Filters are a single compact line to maximize the table area.
- Removed the explanatory report banner from the screen.
- Filter-option endpoint no longer sends thousands of Heat Numbers to the browser.
- Download still retrieves the complete filtered report using `all=1`.
- Thickness displayed at 3 decimals, width as whole mm, chemistry at 3 decimals.
- No database migration is required for v0.9.9.

Installation:
1. Overlay the patch files on the existing ColorshineMes project.
2. Keep existing `.env` files.
3. Restart backend and frontend.
4. Ctrl+F5 in the browser.
