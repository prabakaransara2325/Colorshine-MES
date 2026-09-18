# Colorshine MES V2 — Phase 1 Application Architecture

## Runtime flow
SAP S/4HANA GRN → `sap_inbound_message` → `goods_receipt` / `goods_receipt_coil` → DB trigger creates `QUALITY_HOLD` inventory → Supplier TC/QA → `rm_quality_inspection` → MES-only Usage Decision → DB trigger moves stock to AVAILABLE / BLOCKED / HOLD.

## Application layering
- **PostgreSQL `colorshine_mes`**: transactional truth, inventory integrity, UD triggers and reporting views.
- **Node.js/TypeScript API**: authentication, validation, role checks and transaction boundaries.
- **React/Vite frontend**: desktop/tablet/mobile responsive UI.
- **SAP/L2 connectors** will be added as workers after screen/API stabilization.

## Device behavior
- Desktop/laptop: fixed side navigation + full tables.
- Tablet: drawer navigation + compact tables/workbench.
- Mobile: card views + bottom navigation, no mandatory horizontal scrolling.
