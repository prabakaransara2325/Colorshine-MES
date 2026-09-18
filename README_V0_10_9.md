# Colorshine MES V2 v0.10.9 — Content-First Compact UI

## Purpose
This release focuses on screen density and operator attention. The global breadcrumb already shows module, screen number and screen name, so duplicate page titles/subtitles have been removed from business screens.

## UI changes
- Removed duplicate in-screen page title/subtitle blocks from all screens that use the common `PageHeader` component.
- Retained only essential screen actions (Add, Refresh, Download, Back, etc.) in a small right-aligned action row.
- Reduced the main application header from 82px to 64px on desktop.
- Removed the duplicate current-screen text below `MES Control Center` in the top header.
- Reduced open-screen tab bar and breadcrumb heights.
- Reduced overall content padding so tables and transactions start closer to the top.
- Compacted the screen-number jump control to a small `# + number + arrow` control while retaining direct screen navigation/search.
- Compacted Plant and User controls.
- Reduced master-search/filter control heights, table row padding, action-button size, KPI cards and information banners.
- Increased usable vertical table area in Material, Work Center, Operation and other master screens.

## SAP Sales Order Monitor 2101
- Removed the large `SAP Sales Order Monitor` title area.
- Reduced KPI summary strip height.
- Reduced filter bar padding and field height.
- Moved Refresh into the same filter/action line.
- Reduced table row/header density and increased visible table height.

## Database impact
None. v0.10.9 is a frontend presentation release. Do **not** truncate, reseed, or recreate masters.

## Installation
1. Stop frontend and backend.
2. Back up the current `D:\Colorshine\Color_MES\ColorshineMes` folder.
3. Extract this full package over the existing folder.
4. Start backend and frontend normally.
5. In Chrome press `Ctrl+F5` once.
6. Confirm the footer shows `MES V2 0.10.9`.

No SQL migration or BAT migration is required for v0.10.9.
