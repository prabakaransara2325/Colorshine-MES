# Colorshine MES V2 v0.10.2
## Work Center Capacity Milestones + Group Code Dynamic Control Engine

This patch is designed for the fresh-start database after v0.10.1.

## What changes

### 1. Company + Plant + Work Center hierarchy
Work Center is maintained with the business key:

`Company Code + Plant Code + Work Center Code`

The database validates that the selected Plant belongs to the selected Company.

The existing Master Data screen also gets a **Companies** tab so Company Master can be created before Plant Master.

### 2. Work Center capacity milestones
Each Work Center can maintain a capacity milestone by year:

- Capacity Year
- Year Capacity
- Month Capacity
- Day Capacity
- Capacity UOM
- Remarks

Capacity milestones are stored in `mes.work_center_capacity_milestone`, so a new year can be maintained without destroying the previous year's milestone.

No capacity number is generated or hardcoded by the application.

### 3. Screen 7104 - Group Code & Dynamic Controls
New screen: `7104 - Group Code & Dynamic Controls`

A Group Code defines a configurable business parameter. Supported control modes:

- LOOKUP
- RANGE
- VALUE
- BOOLEAN
- TEXT

A Group Code can be flagged for use in:

- Planning
- Production
- Quality

### 4. Code Details
Each Group Code can have reusable code details, for example:

- Usage Decision codes
- Quality levels
- defect/reason codes
- operation lists
- configurable parameter values

The system provides a generic lookup endpoint by Group Code, so screens do not need to hardcode the values.

### 5. Work Center / Operation Control Rules
A Group Code can be assigned dynamically by:

- Company
- Plant
- Work Center
- Operation Code
- Material Code
- Product Group
- Usage Context: ANY / PLANNING / PRODUCTION / QUALITY

A rule can maintain:

- Min Value
- Max Value
- Target Value
- Detail Code
- Text Value
- Boolean Value
- UOM
- Validation Action: ERROR / WARNING / INFO
- Validation Message
- Priority
- Effective From / To

### Runtime example - RUNTIME
Create a Group Code called `RUNTIME` with:

- Control Mode: RANGE
- Value Type: NUMBER
- Default UOM: MIN
- Use in Production: Yes

Then maintain a Work Center rule with the correct business Min Runtime and Max Runtime.

Production Confirmation should **not** contain numeric runtime limits in code. It resolves the current rule:

```sql
SELECT *
FROM mes.resolve_group_control(
    'RUNTIME',
    '2000',       -- Company
    '2000',       -- Plant
    'CRM01',      -- Work Center
    NULL,         -- Operation Code when not required
    NULL,         -- Material
    NULL,         -- Product Group
    'PRODUCTION',
    CURRENT_DATE
);
```

The resolver chooses the most specific active/effective rule and returns its Min / Max / Target / UOM / Validation Action / Message.

The same resolver is intended for Planning and Quality. This is the core rule: **business values live in masters, not inside source code.**

## Installation

1. Stop backend and frontend.
2. Extract this patch over your project root:

`D:\Colorshine\Color_MES\ColorshineMes`

3. Run once:

`backend\APPLY_V0102_DYNAMIC_CONTROLS.bat`

or:

```powershell
cd D:\Colorshine\Color_MES\ColorshineMes\backend
node scripts\apply-v0102-dynamic-control-migration.cjs
```

4. Restart backend and frontend.
5. Press `Ctrl + F5` in the browser.

No business values are seeded by this migration.

## Recommended fresh-start master sequence

1. Master Data -> Companies
2. Master Data -> Plants
3. Work Center Master 7102
4. Group Code & Dynamic Controls 7104
5. Other material/supplier/thickness/tolerance masters
6. Planning / Production / Quality screens consume Group Codes at runtime
