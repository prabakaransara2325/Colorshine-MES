# Colorshine MES V2 v0.11.0 — TDC Template & Approval Workflow

Plant 2000 implementation of a template-driven Technical Delivery Condition framework.

## Core design

- **4200 TDC Template Master** — system templates, user templates, categories, series, reusable characteristics and number-object visibility.
- **4201 TDC Register** — all TDCs, current version, category, status, approval stage and actions.
- **4202 TDC Create / Revise Wizard** — General Data, Dimensions, Chemical, Mechanical, Surface & Coating, Dispatch & Packing, Review & Submit.
- **4203 TDC Approval** — role/access-group controlled approval inbox.
- No KPI summary tiles were added; the screens follow the content-first UI used from v0.10.11.

## Template governance

An ACTIVE template is immutable. A format change is performed with **Copy as New Template**, requiring a new template code/name. ADMIN, QA and the active Plant 2000 TDC QC Head group can maintain templates. Characteristics can be created centrally and added to any DRAFT template/section. This supports future TDC categories without hardcoded product-specific screens.

## Seeded Plant 2000 system templates

- BGL / GL Standard Format — Plant 2000
- CRFH Standard Format — Plant 2000
- HRPO Standard Format — Plant 2000

The characteristic master contains 45 reusable characteristics identified from the reviewed Plant 2000 TDC formats. The system template mappings contain 31 BGL/GL fields, 27 CRFH fields and 20 HRPO fields; shared characteristics are reused rather than duplicated.

## Number object

TDC numbers are generated only by the database Number Object, scoped by Plant + Prefix + Series. Number entry is not exposed in the create form. TDC version is separate and immutable after Creator Approval. Deactivating a TDC changes only the document master state; historical version approval/status records remain unchanged.

## Workflow

Creator → QC Head → PPC Head → Plant Head.

For UAT, all generated workflow e-mails are redirected to `prabakaransara2325@gmail.com`. Intended group recipients are resolved from `app_user.email` for users assigned to the active TDC approval group, so removing the override later enables group-driven routing without a program change.

See `V0_11_0_INSTALL.txt` before applying the migration.
