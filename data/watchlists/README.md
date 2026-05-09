# Watchlist data files

This directory holds raw watchlist CSV/XML files consumed by the AML screening
loader (`python-service/app/services/aml_loader.py`, implemented by
`python-engineer`).

**Place real list files here before running the watchlist refresh endpoint.**
The repo ignores any file matching `*.csv`, `*.xml`, and `*.zip` in this
directory so that no sanctioned-names data is committed to version control.

---

## Expected format (CSV)

Each CSV must have a header row. The loader maps columns to
`aml_watchlist_entries` as follows:

| CSV column        | DB column         | Notes                              |
|-------------------|-------------------|------------------------------------|
| `name`            | `normalized_name` | Loader applies: lowercase, strip diacritics, token sort |
| `dob`             | `dob`             | ISO 8601 (`YYYY-MM-DD`) or empty   |
| `country`         | `country`         | ISO 3166-1 alpha-2 or alpha-3      |
| *(entire row)*    | `original_record` | Serialised as JSON                 |

### Example

```
name,dob,country
Example Blocked Person,1965-03-21,EG
Example Blocked Entity,,US
```

---

## Supported lists

| File name                  | DB `list_name`     | Source                                      |
|----------------------------|--------------------|---------------------------------------------|
| `ofac_sdn.csv`             | `OFAC_SDN`         | https://www.treasury.gov/ofac/downloads/sdn.csv |
| `eu_consolidated.csv`      | `EU_CONSOLIDATED`  | https://webgate.ec.europa.eu/fsd/fsf         |
| `un_security_council.csv`  | `UN_SC`            | https://scsanctions.un.org/resources/xml/en/consolidated.xml |

---

## Contract reference

Data model spec: `docs/contracts/aml-screening.md` §7 (Data model).

`python-engineer` owns the loader; `db-migrator` owns this directory and the
`aml_watchlists` / `aml_watchlist_entries` schema.
