# Colorshine MES V2 v0.10.3
## Dynamic Runtime Control Framework

This is the cumulative master/configuration patch after the Fresh Start reset.
It contains the v0.10.2 Work Center/Group Code foundation plus the v0.10.3
Operation Master and transaction runtime-binding framework.

## Design frozen in this version

Business rules that can change must not be embedded in Planning, Production or
Quality source code. They are maintained as data and resolved at runtime.

Hierarchy:

Company -> Plant -> Work Center -> Operation
                              |
                              +-> Capacity milestones by year

Group Code -> Code Details -> Context Rules -> Screen Bindings
                                      |
                                      +-> Planning / Production / Quality

## Master screens

- 7102 Work Center Master
  - Company + Plant specific
  - Year / Month / Day capacity milestone by capacity year
- 7104 Group Code & Dynamic Controls
  - LOOKUP / RANGE / VALUE / BOOLEAN / TEXT
  - code details
  - work-center / operation / material / product-group rules
  - ERROR / WARNING / INFO runtime behavior
  - configurable missing-rule behavior
  - screen/control bindings
- 7105 Operation Master
  - Company + Plant + Work Center specific operation code
  - sequence
  - Planning relevant
  - Production Confirmation required
  - Quality relevant

## Runtime APIs

GET /masters/runtime-controls/screen/:screenCode

Returns all Group Codes bound to a screen, resolved for the supplied Company,
Plant, Work Center, Operation, Material and Product Group context.

POST /masters/runtime-controls/validate

Validates an entered number/code/text/boolean against the currently effective
rule. Returned `blocks_transaction=true` is the common rule for preventing a
Planning/Production/Quality transaction from posting.

## Example: RUNTIME

Do not code a fixed runtime in Production Confirmation.

1. Create Group Code RUNTIME
   - Control Mode: RANGE
   - Value Type: NUMBER
   - Default UOM: MIN
   - Used in Production: Yes
2. Create Work Center and Operation.
3. Add a rule for the applicable Company/Plant/Work Center/Operation.
4. Maintain Min / Max Runtime and validation action.
5. Bind RUNTIME to the Production Confirmation screen at ON_CONFIRM.
6. Production Confirmation resolves and validates the rule at runtime.

Changing the master changes the behavior without a source-code deployment.

## Install

Copy this patch over:

D:\Colorshine\Color_MES\ColorshineMes

Keep existing `.env` files.

Run:

backend\APPLY_V0103_DYNAMIC_RUNTIME_FRAMEWORK.bat

The BAT applies SQL 33 and SQL 34. SQL 33 is idempotent, so the patch is safe
whether or not v0.10.2 was already applied.

Restart backend and frontend, then Ctrl+F5.

## Important

No Company, Plant, Work Center, Operation, Group Code, capacity or business
values are seeded. The database remains a clean fresh-start system and the
business masters should now be created in the agreed sequence.
