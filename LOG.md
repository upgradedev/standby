# History

## 2026-10-30 — Codex — corrected freeze and completed verified video

Independent review found inaccurate cohort labels in the accessible map list and overbroad private-results wording in Settings. Recorded unfreeze, corrected only those two runtime surfaces and re-froze at 48caf91933de5f24553c3ae9d0772c12186f3ded. Source CI 41053286838 and final anonymous desktop/tablet/mobile acceptance 41053626057 passed. Previous real Cognito role acceptance remains tied to its original exact release; service/domain code is unchanged. PR4 merged as 5d69709d13f7f1bfa551d171a00b8114b9d0dc4d.

Final video run 41055059142 passed actual encoded media checks: 145 seconds audio and video, 30 fps, 23 cues; MP4 SHA256 c1cd41e1f7ee4241ab5a6f7d6d8445530bb52b5bc7e7c17578e8d879c2687f89. Artifact 12975933421 is retained through November20. Recorded native slate and real post-roll repaired the capture instrument without padding or looser gates; measured scroll timing repaired remaining actions while preserving the same story. No further product changes or routing calls.

Owner-only publication/eligibility and local free space are pending. C: reached zero free bytes; generated-copy cleanup was automatically rejected as blocked by policy. Final documentation is committed through GitHub REST to avoid writing local Git objects. The local checkout still contains pre-final uncommitted STATE/TRAPS edits; after space is available, compare them with this upstream commit before reconciling. Do not re-deploy or re-record the unchanged frozen application merely to reconcile docs. Writer claims released for handoff. No public video upload, new terms acceptance or Submitted state is claimed.

## 2026-10-30 — Codex — complete live acceptance and product freeze

Live acceptance https://github.com/upgradedev/standby/actions/runs/41041997256 passed the complete anonymous journey at desktop/tablet/mobile and real Cognito Analyst/Planner/Admin flows, including exact review, settings conflicts and stale-review invalidation. Earlier test readiness/label/tablet-mode assumptions were corrected while keeping all assertions. Actual app defects fixed were read-concurrency bursts and modal keyboard containment. Frozen application source is 49b8a940f83dcdf72fa5ee72aca7ba55553dcc7a; later changes affect only acceptance/demo tooling, and `git diff 49b8a940f83dcdf72fa5ee72aca7ba55553dcc7a -- apps/console packages services` is empty. Builder draft 3LPVbxnjerX5pvDmH8FsdDG8uuA autosaved the actual dataset/method/source/app narrative. Original neural narration generated within beat budgets after freeze; actual recording/public video and final publication are next.

## 2026-10-30 — Codex — implementation and first AWS release

Created original public source and isolated writer checkouts after build opening. Source checks, tests and build passed in hosted CI. Private Austin import and one bounded AWS Core matrix call completed. Application is live at https://d34x1513u5u1qs.cloudfront.net . Initial CloudFront creation failed on a wrong managed cache-policy identifier; verified the actual AWS policy list, removed only inspected empty resources from that failed initial stack, then recreated successfully. No unrelated or judged surface was touched. First live browser test found concurrent reads exceeded reserved concurrency; CloudWatch confirmed two throttles at the configured concurrency of three, and read capacity was raised to eight without weakening tests. Full acceptance, video and submission remain in progress. USD 25 total approval persists. Routing ESTIMATE USD 0.72 at 1440 pairs times USD 0.0005 per pair, not invoiced spend (`python tools/build-matrix.py --input ../../worktrees/standby-data/.runtime/routing-input.json --attempt 1`).

## 2026-10-29 — Codex — owner approved budget and tomorrow start

Owner explicitly approved USD 25 total and instructed implementation per the specification, beginning with application shell and the map with real data, asking to start tomorrow. Recorded approval in STATE/spec and removed superseded pending-budget statements. Tomorrow is 2026-10-30, official opening 07:00 UTC / 09:00 Europe/Athens; clock tool returned 2026-10-29 13:55:56 UTC in this turn. Existing authorization persists; no renewed budget permission for unchanged work within USD 25. No automatic continuation scheduled, respecting earlier explicit manual-resume preference. No app code, resources or spend created today. Released coordination claim.

## 2026-10-29 — Codex — archived option research after Standby selection

The following earlier option research and source receipts moved from STATE to this append-only history after the owner selected Standby. Current implementation truth is STATE and the linked MVP specification.

## Recommended product — awaiting owner choice

**Heat Memory:** an explorable map for travelers comparing Greek summer destinations, revealing the difference between hot daytime maxima and persistently warm daily minima. Mechanism sentence: "Heat Memory maps observed hot days and warm minima so travelers can compare the heat hidden behind a Greek summer destination."

Core interaction: open a Greece station map; switch between daily maximum at least 35°C and daily minimum at least 25°C; filter a summer/month; click stations; compare two daily calendars; share a URL containing that comparison. Show the surprising Kalamata/Santorini reversal as an immediately executable initial view, then allow exploration. Historical station observations only; no forecast, nighttime-hour measurement claim, island-wide interpolation or hotel-room temperature inference. Define both thresholds explicitly as application choices, not official climate indices.

Dataset: NOAA Global Surface Summary of Day, public S3 bucket `noaa-gsod-pds`. Primary licence/source: https://registry.opendata.aws/noaa-gsod/ (opened through `web.run` 2026-10-29). Open use allowed; attribute NOAA and access date, identify transformed data, never imply NOAA endorsement. Published documentation says observations are summarized in GMT and daily extremes may include part of the previous day. Pin a historical snapshot and retain coverage. Use only station/site coordinates, not personal locations.

Coordinator independently fetched the four source CSVs in memory with Python standard-library `urllib.request` and `csv.DictReader`; no files saved. Filter `2024-06-01 <= DATE <= 2024-08-31`, exclude `9999.9`, count MAX >= 95°F and MIN >= 77°F. These thresholds equal 35°C and 25°C by `(F-32)*5/9`. Source objects return current HTTP success; observed dates run June 1 through August 31 with one calendar day absent. [PRIMARY 2026-10-29]

| Source station and exact S3 object | MAX >=35°C | MIN >=25°C | Valid observed max/min days |
|---|---|---|---|
| KALAMATA: https://noaa-gsod-pds.s3.amazonaws.com/2024/16726099999.csv | 47 | 0 | 91 / 92 calendar days |
| SANTORINI: https://noaa-gsod-pds.s3.amazonaws.com/2024/16744399999.csv | 7 | 49 | 91 / 92 calendar days |
| ATHINAI: https://noaa-gsod-pds.s3.amazonaws.com/2024/16716099999.csv | 71 | 54 | 91 / 92 calendar days |
| DIAGORAS: https://noaa-gsod-pds.s3.amazonaws.com/2024/16749099999.csv | 8 | 63 | 91 / 92 calendar days |

Exact in-memory calculation used for every numeric row above:

```python
import csv, io, urllib.request
for station in ['16726099999','16744399999','16716099999','16749099999']:
    raw = urllib.request.urlopen(f'https://noaa-gsod-pds.s3.amazonaws.com/2024/{station}.csv', timeout=30).read()
    rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
    summer = [r for r in rows if '2024-06-01' <= r['DATE'] <= '2024-08-31']
    mx = [r for r in summer if float(r['MAX']) != 9999.9]
    mn = [r for r in summer if float(r['MIN']) != 9999.9]
    print(station, rows[0]['NAME'], len(mx), len(mn), sum(float(r['MAX']) >= 95 for r in mx), sum(float(r['MIN']) >= 77 for r in mn))
```

Preliminary research is not production ETL: implementation must validate schemas, dates, duplicates, malformed/sentinel values, station coordinates and MIN/MAX metadata flags against the NOAA documentation before shipping. Missing observations are gaps, never cool days. Larger station/year coverage remains unverified.

Architecture proposal: original buildless HTML/CSS/JS with an interactive map, compact reproducible station data from NOAA S3, dedicated private S3 origin and CloudFront OAC HTTPS app. S3 is load-bearing as both real source and served dataset. No database, language model or location tracking needed. Prefer a map renderer/style with verified reuse rights and attribution; if tiles are an external availability dependency, provide a usable local geographic fallback and a station comparison list. No map provider/key has been selected.

Acceptance before recording: source-derived numbers agree; comparison/filter/deep link works; coverage and provenance visible; no login or key needed; keyboard and mobile journey works; anonymous live URL returns HTTP 200; direct S3 origin denies anonymous access; live release identifier matches reviewed commit; offline CI build/data checks and secret scan green. Break one data input deliberately to show its validator fails. Record only against declared frozen live commit.

Hosting estimate from child pricing research: approximately USD 0.98/month for 0.1 GB storage, 100 uploads, 10,000 origin GETs, 10 GB CDN transfer, 100,000 HTTPS requests, before taxes/free allowances/map API costs (ESTIMATE, not spend or budget approval). Pricing reproduction: `aws pricing get-products --profile default --region us-east-1 --service-code AmazonS3 --filters Type=TERM_MATCH,Field=regionCode,Value=eu-west-1 Type=TERM_MATCH,Field=volumeType,Value=Standard`; child verified request/CloudFront prices separately. Coordinator has not independently rerun pricing, so [STATE-FILE]. Verify actual free-plan enrollment or a finite approved cost cap before allocation; keep the map up throughout judging and do not schedule destructive teardown based on stale notes.

## Expanded metrics research — owner requested before product selection

Both business and consumer propositions fit the organizer's broad application requirements; no consumer-only restriction was found in the live rules captured earlier. This is a product-option analysis, not approval to build all layers.

| Family | Candidate metrics | Source/availability and interpretation |
|---|---|---|
| Heat | Temperature minimum/maximum/mean, daily range, threshold frequency, consecutive hot days, warm minima, percentile/anomaly, explicit-base degree-days | NOAA GSOD station observations on AWS; multi-year coverage still to verify. Daily minimum does not identify evening-hour or indoor conditions. |
| Moisture/comfort | Dew point, humidity, apparent temperature, wet bulb, UTCI, time within operator-selected limits | Hourly model/reanalysis products needed for most; do not derive hourly comfort from station daily averages. |
| Wind | Speed, maximum sustained speed, gust, direction, wind rose, directional frequency, threshold exceedance and joint day/hour windows | GSOD supplies daily speed/gust but no wind direction. Direction and hourly windows need another source. |
| Precipitation | Amount, rain-day frequency, duration, intensity, dry spells, snow, forecast precipitation probability | Historical occurrence, observed amount and forecast probability are different variables; missing/trace precipitation flags matter. |
| Sun/light | Daylight, sunrise/sunset, sunshine, cloud, UV, solar radiation, golden-hour windows | Daylight is astronomical; sunshine is weather-dependent; real shade needs geometry. |
| Marine | Sea temperature, waves/swell height/direction/period, current, tide, coastal orientation exposure | Model grids, not a sheltered cove observation; no swimming/navigation/ferry cancellation conclusions. |
| Environmental context | PM/dust/ozone/pollen, official fire-weather indicator, official closures, river discharge, annual bathing-water classifications | New sources/resolutions; display official notices and dated context rather than inferred safe routes. |
| Calendars | Public/local holidays, destination/origin country, long weekends, leave-day efficiency, school vacations, event date/type/duration | Curated authoritative calendars or licensed service. School calendars are separate and jurisdiction-specific. |
| Tourism demand | Overnight stays, arrivals, domestic/foreign share, seasonality, growth, duration, nights per resident/area | Eurostat/ELSTAT/BoG historic regional data; no real-time local crowd inference. |
| Arrivals/events | Scheduled cruise calls/overlap/capacity, flight traffic/schedules/seats, event capacity/ticket state | Official/operator feed and reuse rights required; schedules/capacity are not actual attendance or people ashore. |
| Actual crowd/traffic | Pedestrian flow, venue occupancy, queue length, parking occupancy, road speed/volume, vehicle occupancy | Genuine sensor or licensed provider/operator feed required. Greek nationwide coverage has not been established. |
| Access/mobility | Route distance/time, time-budget catchment, transfers, departures/headway, last connection, delays/cancellations, explicit wheelchair attributes | Amazon Location/GTFS/local operators; specific geography/feed coverage still to validate. Unknown accessibility is not inaccessible. |
| Amenities/supply | Mapped toilets/water/pharmacies/museums/indoor alternatives/charging, nearest facility, category density/diversity, opening hours where reliable | Overture/OSM/provider; mapped POIs are not open-now/capacity/popularity/customer counts. |
| Geography | Elevation/slope/aspect, coastline orientation, distance to shore, tree/green/built fractions, protected boundaries, resident population, nighttime radiance | DEM/WorldCover/GHSL/Natura/NASA. Tree cover is not time-specific shade; radiance is not nightlife/noise/crowd. |
| Money/availability | Comparable stay/transport/activity prices, taxes/fees, availability, booking lead time, cancellation/min-stay terms | Partner/provider terms and actual requested dates/party needed. No market-wide occupancy from empty listing results. |
| Business-owned operations | Bookings, available capacity, load factor, staffing/equipment, cancellations, revenue/margin, conversion, pickup distribution | Future private operator integration; public challenge demo uses clearly labelled synthetic aggregates only, no customer or personal data. |
| Data evidence | Valid count/denominator, missingness, timestamp, source version, flags, station distance, grid/administrative resolution, observation/model/proxy label | Mandatory across all layers. An existence/confidence or completeness score is not a popularity score. |

Dimensions orthogonal to these metrics: geography and native spatial grain; date/year/month/season/weekday/hour and timezone; origin vs destination jurisdiction; activity/business type; travel mode; party constraints and budget/preferences entered without personal tracking; historical observation vs reanalysis vs forecast vs scheduled event vs scenario; source/version/quality; value vs rate/percentile/anomaly; chosen threshold; data-valid denominator.

Coordinator primary checks in this research turn:

- NOAA current object fields and temporal coverage re-read in memory using `urllib.request.urlopen('https://noaa-gsod-pds.s3.amazonaws.com/2024/16744399999.csv')` and `csv.DictReader`. Source/rights checked through `web__run(open=[https://registry.opendata.aws/noaa-gsod/])`.
- Eurostat actual JSON GET `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/tour_occ_nin2m?lang=EN&geo=EL42&time=2024`, parsed using `urllib.request` + `json.load`: monthly overnight series inside an annual-year dimension, South Aegean regional geography, domestic/foreign/total categories, several units. The API's frequency label is Annual; month is an explicit separate dimension. Preserve metadata/flags. Source updated date is metadata, not evidence of live crowd.
- Official commercial/non-commercial reuse with acknowledgement checked: https://ec.europa.eu/eurostat/help/copyright-notice . Greek regional data fit the EU scope; some non-EU/third-party exceptions exist.
- Weather source functionality and service terms checked: https://open-meteo.com/en/docs , https://open-meteo.com/en/docs/historical-weather-api , https://open-meteo.com/en/docs/marine-weather-api , https://open-meteo.com/en/docs/air-quality-api , https://open-meteo.com/en/terms . Free hosted API is non-commercial only; data licence does not cancel API access terms. Commercial API plan or appropriately licensed upstream access required for a business production product.
- Thermal comfort source checked: https://cds.climate.copernicus.eu/datasets/derived-utci-historical?tab=overview . This is ERA5-derived reanalysis, not a measuring station.
- Holidays service terms checked: https://nagerholidays.com/legal/termsofservice . Hosted API requires active sponsorship for commercial use; MIT source-code licence does not override hosted API terms.
- Google actual current capability checked with `web__run(find=[{ref_id:'https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details',pattern:'popular-times'}])`: official Places UI Kit can display typical hourly and live busyness where available. This is not evidence of raw downloadable crowd counts for a custom heatmap. No scraping/export/aggregation assumed. Official EEA guidance: https://developers.google.com/maps/comms/eea/places?hl=en (UI Kit differs from Places API restrictions). Specific place coverage/billing still untested.
- Overture source checked via https://docs.overturemaps.org/guides/places/ : public AWS data; documented quality/completeness issues; confidence describes existence only; current schema uses taxonomy/basic_category rather than removed categories. Greek local completeness not tested.
- Other primary source capabilities checked: https://docs.aws.amazon.com/location/latest/developerguide/routes.html ; https://gtfs.org/documentation/schedule/reference/ ; https://www.openstreetmap.org/copyright ; https://registry.opendata.aws/copernicus-dem/ ; https://esa-worldcover.org/en/data-access ; https://human-settlement.emergency.copernicus.eu/datasets.php ; https://www.eea.europa.eu/en/analysis/publications/european-bathing-water-quality-in-2025 ; https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/fire-danger-forecast ; NASA Black Marble primary product documentation https://viirsland.gsfc.nasa.gov/Products/NASA/BlackMarble.html . Documentation verification is not proof a particular Greek local extract/feed is complete or deployable.

Combination method: calculate counts and shares of the SAME valid day/hour satisfying all explicit thresholds, and show failed conditions separately. Do not multiply marginal weather probabilities; do not join a region-month tourism statistic to a street-hour and label it observed density. For monthly nights/population comparisons an optional descriptive ratio is `nights / days_in_month / population`, with all dates/units aligned; this omits day visitors and is not total people present. Keep raw tourism levels, holiday/schedule flags and weather evidence visible rather than hiding them in an arbitrary crowd/opportunity score.

Potential consumer decisions: choose destination/month; minimize leave days; compare warm-minimum burden; identify reachable indoor alternatives; compare documented access/amenity constraints; inspect broad wind/coastal context. Potential business buyers: Greek walking/cultural-tour operators choosing shoulder-season destination/month; small hotel excursion desks offering reachable alternatives; destination managers comparing seasonal pressure and amenities; excursion operators viewing scheduled arrivals; event planners comparing historical conditions/access/calendars; shuttle operators using their own aggregate pickup bookings. Site selection, dynamic pricing, revenue forecasting and demand prediction need stronger commercial data and outcome validation than open POI/weather layers.

Research recommendation: broaden the concept to a transparent travel/activity-window map, with one primary buyer/decision selected before implementation. Strong coherent business candidate: a small Greek walking/cultural-tour operator comparing destinations and shoulder-season months against its own daily weather limits, with holiday and regional overnight context. Narrow delivery candidate: verified station history over multiple years if available, temperature/rain/wind joint-day filters, country calendars, one regional tourism context panel, provenance and shareable comparison. Live crowds, hourly forecasts, pricing/booking integrations, marine operations and automated business outcome promises remain separate extensions. A single verified summer is a demonstration, not a climate baseline or future-probability model.

## Scenario selection and roadside assistance — research decision

Coordinator ranking is an ESTIMATE of fit/execution, not judge scores, validated win probabilities or an owner selection. All official criteria are equally weighted. Best current candidate: narrowly scoped Roadside Standby Planner with real incident history, AWS road-time matrix and a transparent before/after coverage comparison. Its strongest advantages are a specific shift-manager decision, load-bearing AWS routing, direct geographic counterfactual and an inspectable replay. Existing facility-location methods are established; do not claim invention of that algorithm. Best tourism business alternative: Season Windows for small Greek walking/cultural-tour operators. Fastest fallback: consumer Heat Memory. Broader consumer travel windows and live hotel alternatives introduce more feeds and scope risk.

Effort ranges are ESTIMATES, not measured throughput, and include a narrow app, AWS publication, meaningful verification, public video and write-up. Heat Memory: 14–22 focused person-hours; narrow Season Windows: 20–30; consumer Travel Windows: 24–36; hotel alternatives: 30–45; narrow roadside single-unit-class historical replay: 28–45 once source readiness is established. Multitype dispatch, live patrol optimisation and trained demand prediction are additional scope; do not fit them into the same estimate. Choose a bounded early working release and preserve time for mandatory deliverables before the official deadline.

### Primary roadside data evidence, checked 2026-10-29

Official dataset: https://data.austintexas.gov/d/dx9v-zd7x ; catalogue https://catalog.data.gov/dataset/real-time-traffic-incident-reports . Coordinator independently queried public Socrata API with Python standard-library `urllib.request`, `urllib.parse.urlencode`, `json.load`, no token, no files saved.

Exact grouped query:

```python
base = 'https://data.austintexas.gov/resource/dx9v-zd7x.json'
q = {'$select':'issue_reported,count(*) as n,min(published_date) as first,max(published_date) as last',
     '$where':"upper(issue_reported) like '%STALL%'", '$group':'issue_reported'}
url = base + '?' + urllib.parse.urlencode(q)
print(json.load(urllib.request.urlopen(url, timeout=25)))
```

| Source label | Row count from above command | First / last published dates from above command |
|---|---|---|
| Stalled Vehicle | 11588 | 2020-10-01 / 2026-10-29 |
| zSTALLED VEHICLE | 8930 | 2017-09-26 / 2020-09-30 |

These are raw row counts; uniqueness, duplicates, coordinate validity and completeness are not yet audited. Both category labels must be normalized deliberately rather than dropping legacy history. Coordinator also fetched recent `Stalled Vehicle` rows with `$select=traffic_report_id,published_date,issue_reported,latitude,longitude,traffic_report_status`, `$limit=3`, `$order=published_date DESC`; actual results include ARCHIVED records with timestamps and coordinates. Archived status is not a mechanic arrival/completion time.

Current official portal policy: https://datahub.austintexas.gov/stories/s/ranj-cccq . Coordinator fetched the HTML using `urllib.request.urlopen` and inspected source text around Licensing Summary, public domain and without restriction. It says portal data are freely offered without restrictions and are public domain unless metadata specifies otherwise; it separately prohibits re-identification and disclaims correctness/endorsement. Coordinator independently fetched `https://data.austintexas.gov/api/views/dx9v-zd7x.json` with `urllib.request`/`json.load`: licenseId/license are null, attribution is City of Austin, Texas, and no separate restrictive notice was present in the inspected dataset metadata. Retain the policy and attribution on publication. The generic austintexas.gov website file-modification notice is a different surface from this specific open-data policy. The PDF attachment has font extraction problems; use the verified current policy page rather than assuming garbled PDF extraction is a successful read.

Data meaning: public-safety-reported stalled vehicles in Austin/Travis County, not all commercial roadside requests. No source fields establish actual required vehicle type, mechanical fault, customer entitlement, service duration or real company fleet. Public demo should omit incident identifiers and exact addresses, aggregate appropriately to road segments/zones, and use no medical/crash details. Greek equivalent breakdown coverage was not established; weather/holidays/traffic are context/exposure rather than measured breakdown demand. Austin evidence cannot support Greek accuracy claims.

### Roadside product boundary

Primary user: roadside operator's shift manager. Trigger: beginning a shift or a unit becoming unavailable. Output: proposed waiting points, road-time coverage comparison and uncovered zones in the existing dispatch/shift-planning workflow.

- Start with a fixed fleet size, a single service class and operator-approved or explicitly simulated candidate standby points. Show where units wait; moving patrol optimisation is a separate problem.
- Use real source incidents for spatial demand replay and clearly labelled assumed fleet/site/availability settings. Required service class is unknown in Austin; motorcycle-versus-platform scenarios cannot be presented as source-observed demand.
- Type-compatible coverage matters: light roadside help cannot satisfy tow requirements. Company implementation needs appropriately anonymized zone/time/capability history, actual dispatch/departure/arrival/completion times, vehicle capabilities/shifts and approved standby locations.
- AWS modern route matrix: https://docs.aws.amazon.com/location/latest/APIReference/API_CalculateRouteMatrix.html ; traffic https://docs.aws.amazon.com/location/latest/APIReference/API_RouteMatrixTrafficOptions.html ; coverage https://docs.aws.amazon.com/location/latest/developerguide/data-quality.html . Coordinator primary reads confirm pairwise origins/destinations, departure/traffic options, Car/Scooter/Truck profiles and Greece coverage. Scooter is not a universal motorcycle model and grants no lane-filtering assumption. No paid matrix executed; API authorization and bounded actual spend still untested.
- Calculate road-directional travel times, not circular distance coverage. Candidate sites must be valid for the modeled vehicle and road direction; a mapped parking/fuel facility is not permission to wait there.
- Possible small model: maximum weighted incident coverage under an operator-chosen travel-time limit, with a separate view of underserved zones; greedy/local search labelled heuristic unless exact enumeration proves optimum for the stated finite model.
- Metrics: source-event coverage within selected travel-time limit, mean/median/p90 modelled road travel time, uncovered zones, backup coverage, repositioning distance, and loss of coverage when a unit becomes busy. None is automatically actual customer waiting time.
- Compare same fleet, candidate set and route-time snapshot against depot-only AND a reasonable geographically spread baseline. Choose placements on earlier incidents, evaluate later held-out incidents, report both gains and losses. Current/planning-time route matrices are not reconstructed historical traffic or actual response records.
- Static nearest-unit coverage assumes availability; concurrent jobs, queueing, dispatch delay and service duration need separate assumptions/simulation. Frame public result as planning/replay, with no automatic deployment or live dispatch claims.

Winning-demo hypothesis (ESTIMATE): fixed fleet and real historical incident layer; inspect current modeled coverage; recalculate standby sites; show changed coverage and uncovered events; remove a unit to expose resilience tradeoff. AWS route calculation is load-bearing. No numeric gain, customer impact or operational outcome is claimed before the instrument executes and passes review.

## 2026-10-29 — Codex — Standby selected and implementation specification reviewed

Owner selected roadside assistance and requested the concrete MVP/data/AWS/demo plan plus a React/TypeScript/Tailwind/TanStack operations console based on FrontBox patterns. Created `docs/STANDBY_MVP_SPEC.md` under the long-spec exception and linked it from router/STATE. Read FrontBox doctrine/source only. Three independent read-only agents checked UI reference, source/model contracts and architecture, then reviewed the saved spec. Integrated Settings/search/queue contracts, independent holdout-zone rule, raw-cache origin isolation, trusted result persistence, builder-only atomic budget and provider cache expiry/retention. Coordinator independently reproduced annual source counts/hashes and live Ireland Location price catalogue. Proposed spend envelope remains a proposal. No app code, dependencies, repo publication, cloud mutation, paid route call, automation or submission before the official opening under the previously disclosed conservative interpretation. Released claims; implementation is authorized for the next active session after opening.

## 2026-10-29 — Codex — scenario ranking revised after real roadside-data discovery

Owner requested comparison of best consumer/business entries and proposed roadside standby positioning. Independent review initially preferred Season Windows because actual breakdown demand was missing. Separate data research found Austin archived Stalled Vehicle history. Coordinator independently reproduced grouped counts and recent archived coordinate/time samples, read current open-data policy text, and checked AWS route matrix/traffic/Greece coverage docs. This evidence raises narrow roadside historical coverage planning to coordinator's first recommendation, pending owner selection. STATE records source limits, raw-row counts and exact query, explicit simulated fleet/site inputs, temporal holdout/fair-baseline requirements, and ESTIMATE effort ranges including deliverables. No data is treated as company service classifications or actual response outcomes. No product code, paid API call, cloud resource, automation or submission. Released claims.

## 2026-10-29 — Codex — exhaustive metrics/options research

Owner asked to broaden beyond heat, evaluate business as well as consumer, and exhaust useful map metrics/dimensions alone and combined. Delegated weather, demand/calendar and geography/business primary-source research independently, then verified source capabilities/terms and an actual Eurostat JSON response directly. Added the metric families, orthogonal dimensions, grain/temporal/denominator constraints, provider rights and product options to STATE.md. Current Google Places UI Kit does display popular-times/live busyness where available, but this does not establish exportable raw crowd data. Open-Meteo free API and hosted Nager service have commercial-use restrictions despite permissive data/code licences. Regional overnight data are available and useful; nationwide Greek live footfall was not established. Recommended conditions windows for a precise tourism-operations decision, pending owner choice. No product code, deployment, paid service, automation or submission. Released research claim.

## 2026-10-29 — Codex — recommendation verified; wait for owner

Owner declined automatic continuation and requested the requirements and recommendation first. No automation created. Recommend Heat Memory, pending owner selection. Independently reproduced the Kalamata/Santorini hot-day/warm-minimum reversal from actual NOAA 2024 S3 objects; exact command, raw object links, counts, coverage and scientific limits are in STATE.md. Verified NOAA open-use/attribution terms at the AWS Registry, independently converted opening/deadline through Python zoneinfo, and reached the existing YouTube Studio upload dialog without uploading. Closed upload dialog. No application files, repo, deployment or submission created. Released all research claims.

## 2026-10-29 — Codex — primary rules read and preparation claimed

Owner requested execution of the AWS Map it challenge and a winning entry. Read workspace router and multi-agent contract. Read About, Rules, Your project and Discussion in the owner's authenticated Chrome session. Rules last updated October 28. There is no project yet and no discussion clarification. Captured equal-weight rubric, identical winner slots, dataset/privacy/OSI/video obligations and official time window in STATE.md.

Created this fresh project contract with an exclusive coordinator claim; delegated independent read-only local capability/timing and dataset/concept research. Verified `aws sts get-caller-identity --profile default --query Arn --output text`, `gh auth status` and `Get-PSDrive -Name C`. No product code, repo publication, cloud mutation, legal acceptance or submission. Pre-window code is deferred as a risk-minimizing interpretation of the build-period wording, not a claimed explicit prior-code prohibition.
