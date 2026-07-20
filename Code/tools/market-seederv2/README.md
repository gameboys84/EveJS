# Public EveJS Market Seeder v2

`market-seederv2` builds the standalone market-server SQLite database from the
latest public Tranquility market-order snapshot.

It intentionally keeps station markets only. Player-structure orders are dropped
because Public EveJS does not seed those TQ structures.

## Normal Run

From the repository root:

```text
BuildMarketSeedV2.bat
```

The tool fetches the latest EVE Ref market snapshot, prints the snapshot file
time and the order-page timestamp range, asks before replacing an existing
database, and writes:

- static region/system/station/type tables from `_local/gameStore/data`
- the configured live market scope through the compatibility importer
- optional NPC station stock outside that live market scope
- TQ sell liquidity into `seed_stock`
- TQ buy demand into `seed_buy_orders`
- no TQ rows into `market_orders`, because that table is player/escrow-backed
  at runtime
- region summary tables for fast market browsing
- a Public-compatible manifest for the existing market daemon

`seed_stock` and `seed_buy_orders` are compatibility tables keyed by
`station_id + type_id`, not per-order snapshot tables. When multiple TQ orders
exist for the same station/type/side, v2 keeps the top-of-book price and the
quantity available at that exact top price. The build summary prints the raw
station-order count and the smaller compatible seed-row count so the collapse is
visible.

## Direct CLI

```powershell
cd tools\market-seederv2
cargo run --release -- --config config/market-seederv2.local.toml build
```

For automation, pass `--yes` to overwrite the existing database without an
interactive prompt.

To build the normal Jita market plus real NPC station stock, use the combined
market-scope mode:

```powershell
cd tools\market-seederv2
cargo run --release -- --config config/market-seederv2.local.toml build --order-filter market-scope-with-npc --market-solar-system-id 30000142
```

The equivalent config values are:

```toml
[import]
order_filter = "market_scope_with_npc"
market_solar_system_ids = [30000142]
npc_order_duration_threshold_days = 90
```

`market_scope_with_npc` accepts every station order in the configured market
systems, then also accepts every NPC-duration station order from the same
snapshot. This lets a build stock Jita from live market data while still adding
Skillbook, BPO, commodity, and other NPC station stock at the stations where TQ
actually sells it.

Other import modes:

- `all_station`: every valid station order in the snapshot.
- `market_scope`: only station orders in `market_solar_system_ids`.
- `npc_only`: only station orders whose duration is above the normal player
  order limit.
- `player_only`: only normal player-duration station orders.

On current EVE Ref snapshots, NPC station orders use 365-day duration. The
default threshold is `duration > 90`.
