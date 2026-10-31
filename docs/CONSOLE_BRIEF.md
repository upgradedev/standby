# Console brief: Standby

- Brief owner: ιδιοκτήτης προϊόντος / υπεύθυνος λειτουργίας οδικής βοήθειας.
- Last updated: 2026-10-31.
- Status: **Wireframe, shell/Overview and first list/detail OWNER-APPROVED; automated candidate QA passed. Owner-requested unit-map/towing clarity is implemented and automated QA passed at1e5efce; renewed Step5 owner visual review is APPROVED; Step6 controlled preview is owner-approved, deployed and post-deploy verified; human final-release checks remain pending.**
- Route: **A / adapt**, ήδη εγκεκριμένο. Διατηρούνται router, tokens, auth, API conventions και TanStack Table.
- Project: C:/dev/solutions/private_nebius_aiserverless_challenge/repos/aws-map-it. Το παρόν draft συντάχθηκε σε απομονωμένο worktree docs/capacity-design.
- Template: αντίγραφο του ops-console-ui/assets/console-brief.md, με τα ίδια 17 τμήματα. Τα skills μένουν ανέπαφα.
- Latest owner agreement: ενσωμάτωση της έρευνας και υλοποίηση MVP με μικτό στόλο, ταυτόχρονα incidents, ουρές, διαφοροποιημένους χρόνους και what-if, με εμφανείς επεξεργάσιμες παραδοχές όπου λείπουν δεδομένα. Δεν απαιτούνται πραγματικά insured/driver δεδομένα για αυτό το MVP.
- Gate: οι προηγούμενες εγκρίσεις wireframe, shell/Overview και first list/detail ισχύουν. Το τελευταίο «Ok προχώρα» εγκρίνει τις προτεινόμενες βελτιώσεις εντοπισμού units και τον έλεγχο towing. Η δομή παραμένει έξι προορισμών και τεσσάρων detail tabs. Το Step5 οπτικό review εγκρίθηκε ρητά. Human keyboard/role/native-popup checks, Step6 open-item decisions και χωριστά video/publication gates παραμένουν.
- Existing = frozen live release 5ad96cc. MVP = συμφωνημένο επόμενο increment, όχι ήδη deployed. Deferred = διατηρημένο αίτημα εκτός παρούσας υλοποίησης. Assumed = editable scenario input, όχι εμπειρική εκτίμηση ή SLA.

## 1. Product and users

Το Standby βοηθά υπεύθυνους βάρδιας οδικής βοήθειας να συγκρίνουν πού περιμένουν συμβατές μονάδες και πώς ένα υποθετικό φορτίο ταυτόχρονων εργασιών δημιουργεί ουρές. Απευθύνεται αρχικά σε περιφερειακό operator που χρησιμοποιεί ήδη dispatcher. Αυτό είναι υπόθεση buyer-fit προς επιβεβαίωση, όχι traction ή υπόσχεση εξοικονόμησης.

**MVP done:** διατηρημένο πραγματικό ιστορικό/χάρτης, Capacity lab με baseline/candidate μικτό roster, capabilities, site/availability/shift, παραμετρικές διάρκειες ανά τύπο, overlapping modeled jobs, συμβατή ανάθεση/ουρά, paired seeded comparison και linked time bars/jobs/map detail. Κάθε input/output φέρει το mode/provenance. Η δομή UI περνά πρώτα ρητή wireframe έγκριση. Dropdown και map-detail βελτιώσεις παραμένουν στην UI παράδοση μετά το checkpoint.

Το trigger είναι προετοιμασία βάρδιας ή αλλαγή διαθεσιμότητας. Η έξοδος είναι ελέγξιμη σύγκριση σεναρίων. Το υπάρχον εταιρικό dispatch workflow και πιθανό integration δεν είναι ακόμη συνδεδεμένα. Δεν υποστηρίζεται αυτόματη πραγματική ανάθεση σε οδηγό.

Η έρευνα [RESEARCH.md](research/standby-evidence/RESEARCH.md) οδηγεί σε spatial baseline + bounded discrete-event simulation. Vendor overlap είναι μερικό: Swoop ήδη διαθέτει equipment/availability/queue-aware matching και ιστορικό offer-volume simulator, όχι τεκμηριωμένα το ίδιο capacity model. Agero/Urgently ανήκουν στον ίδιο όμιλο μετά τη δηλωμένη εξαγορά. Η έρευνα δεν αποτελεί independently validated performance.

| Id | Αρχικό αίτημα | Κατάσταση αυτού του increment |
| --- | --- | --- |
| C01 | Dropdown UI/CSS | MVP UI μετά το wireframe OK: ευανάγνωστο menu/focus σε dark/light, keyboard και mobile. |
| C02 | Πλήρης χάρτης detail | MVP: modeled-job detail με κύριο map region, coordinates/precision και επέκταση· historical zone διατηρεί τη δική της σημασία. |
| C03 | Driver / insured | Deferred πραγματική πηγή/PII. Το MVP χρησιμοποιεί μόνο modeled job IDs, χωρίς επινοημένα ασφαλισμένα πρόσωπα. |
| C04 | Coordinates/address/postcode/map | MVP: coordinates του sampled zone representative με σαφή approximate/derived ένδειξη. Exact street/postcode/deep operational location enrichment deferred. |
| C05 | Start/end/type | MVP: simulated lifecycle timestamps και synthetic battery/tyre/breakdown/collision types. Δεν βαφτίζονται πραγματικές αιτίες του Austin. |
| C06 | Ταυτόχρονα incidents / επάρκεια | MVP: arrivals, compatible assignment, queue, busy cycle/release και paired roster comparison. Καμία staffing guarantee. |
| C07 | Διαφορετικό resolve time | MVP: editable triangular onsite ανά type και εμφανή flatbed transport/dropoff, prep/recovery assumptions. |
| C08 | Ώρες/weekday/weekend | MVP: editable duty intervals και οκτώ arrival-weight bins. Empirical local calendar/staffing forecasts deferred. Δεν προεξοφλείται λιγότερη νυχτερινή στελέχωση. |
| C09 | Time progress/peaks | MVP: pause/scrub και linked modeled queue/availability bars. Play/speed μόνο ως ελεγχόμενο replay υπολογισμένου log. |
| C10 | Calendar/Χριστούγεννα | Deferred verified ημερήσιο ιστορικό και holiday forecast. Ελεύθερο scenario name δεν μετατρέπει μία υπόθεση σε εορταστική πρόβλεψη. |
| C11 | Anomaly detection | Deferred μέχρι joint history/support/validation. Research detector δεν εμφανίζεται ως deployed. |
| C12 | What-if | MVP: baseline/candidate fleet mix/site/availability/shifts, shared arrivals/seed/durations και σαφείς αλλαγμένες παραδοχές. |
| C13 | Weather/wind/rain/traffic/crowding | Deferred adapters και empirical effects. Μόνο explicit travelMultiplier scenario assumption, όχι live traffic ή weather data. |
| C14 | Application shell | Existing shell διατηρείται, με έκτο nav item Capacity lab, states/RBAC/responsive και action badges. |
| C15 | Πού βρίσκονται τα units στον χάρτη; | MVP implemented and verified: εμφανή resident unit IDs, σαφές site ID/count, Locate και ξεχωριστό availability toggle, αμφίδρομη επιλογή χάρτη/λίστας, χωρίς πλαστά GPS offsets. Historical fleet παραμένει generic· mixed kind προκύπτει μόνο από το Capacity roster. |
| C16 | Μία πλατφόρμα μεταφέρει ένα όχημα μέχρι παράδοση σε συνεργείο | Existing engine ήδη δεσμεύει μία μονάδα για ένα job μέχρι το availableAgain. MVP verified: hand-computed concurrency regression και εμφανής modeled φόρτωση/μεταφορά/εκφόρτωση/recovery. Πραγματικό συνεργείο, διαδρομή/ουρά παράδοσης και επόμενη προσέγγιση από το συνεργείο δεν είναι συνδεδεμένα· οι χρόνοι παραμένουν παραδοχές. |

Budget USD25 total παραμένει εγκεκριμένο. Η live5ad παραμένει μέχρι να επαληθευτεί η αντικατάσταση. Υπάρχον video αφορά αποκλειστικά5ad και χρειάζεται νέο evidence εφόσον αλλάξει το submitted runtime.

## 2. Roles

| Role | MVP reads | MVP actions | Never |
| --- | --- | --- | --- |
| public | Sanitized Austin history, map, assumption-based scenarios | Edit temporary scenario inputs, bounded compare/replay | Private data, shared writes, paid routing, πραγματικό dispatch |
| Analyst | Public views και επιτρεπόμενο workspace evidence | Non-mutating scenario evaluation, προσωπικές προτιμήσεις | Shared plan review, access management, πραγματικά insured/contact πεδία |
| Planner | Authorized plans και scenario runs | Draft/edit versioned plans βάσει υπάρχουσας πολιτικής, compare/review request | Cross-workspace writes ή αποστολή σε πραγματικό οδηγό χωρίς integration |
| Admin | Workspace settings/provenance/audit | Υπάρχον exact-result review και εγκεκριμένο configuration | Υπόθεση ότι ο ρόλος δίνει αυτομάτως πρόσβαση σε οποιοδήποτε PII |

Το wireframe role switcher είναι review-only. Στο προϊόν ιδιωτικά permissions προέρχονται από Cognito JWT και server membership. No session δίνει μόνο public mode· private routes fail closed. Local scenario editing δεν ισοδυναμεί με authorized shared save.

## 3. Top 3 jobs per role

| Role | Jobs και συχνότητα |
| --- | --- |
| Public | Κατά την αξιολόγηση: ελέγχει προέλευση, αλλάζει παραδοχές, επιθεωρεί modeled αποτέλεσμα χωρίς login. |
| Analyst | Πριν από βάρδια/ανάλυση: συγκρίνει κοινά arrivals, διαβάζει paired deltas/denominators, ελέγχει assumptions/provenance. |
| Planner | Σε αλλαγή roster: ελέγχει capabilities/βάρδιες, συγκρίνει baseline/candidate, επιθεωρεί queue και job detail/map. |
| Admin | Περιοδικά: ελέγχει configuration/source freshness, review του exact plan result, διαχειρίζεται υπάρχουσα workspace policy. |

Desktop-first, phone-complete. Χρήστες/shift-centre workflow και willingness to pay παραμένουν ερευνητικά open, όχι εμπόδιο στο εγκεκριμένο scenario MVP.

## 4. Entities and statuses

| Entity | MVP meaning / fields | Provenance |
| --- | --- | --- |
| DemandZone | Υπάρχον training-derived polygon/representative/counts | Derived from Austin reports· όχι ακριβές incident/customer address |
| UnitSpec | Scenario unit id, kind, capabilities, home site, available flag, duty start/end | Assumed roster· motorcycle/service van/flatbed δεν είναι ανταλλάξιμα |
| ServiceProfile | Type, typeShare, onsite min/mode/max, flatbed transport/dropoff | Assumed editable configuration, version/hash |
| CapacityScenario | Horizon, incident count, seed, replications, response target, οκτώ arrival weights, prep/recovery/travel multiplier | Assumed inputs |
| ModeledJob | Run/replication/job ID, synthetic type, sampled zone, arrival/assignment/scene/service/available times, assigned unit or queue reason | Simulated· καμία insured/driver οντότητα |
| CapacityRun / Comparison | Baseline/candidate roster, shared streams, inputs/result hashes, result totals and job/unit timeline | Immutable modeled result tied to inputs |
| ExistingPlan | Υφιστάμενο spatial evaluation/review record | Existing server-authorized store |

Modeled job states: queued → assigned/en_route → on_scene/in_service → completed, με χωριστή unit recovery/release. Unserved/unfinished στο horizon διατηρούνται στο αποτέλεσμα. Οι ακριβείς wire enums ακολουθούν το συμφωνημένο domain DTO, όχι ανεξάρτητο αντίγραφο στο UI. Καμία διπλή ενεργή ανάθεση μονάδας. Flatbed dispatch capacity=ένα ενεργό job/μία δεσμευμένη θέση· οι μονάδες δεν ανατίθενται ξανά πριν το recorded availableAgain. Μεταφορά και drop-off περιλαμβάνονται πριν το job completion, recovery προστίθεται πριν τη διαθεσιμότητα. Κατά handling/loading το ακριβές loaded instant δεν καταγράφεται: φορτίο unknown έως τη modeled μεταφορά,1 στη μεταφορά/εκφόρτωση,0 μετά το drop-off. Το recovery μπορεί να κρατά τη μονάδα busy με φορτίο0. Οι ενδείξεις είναι modeled, όχι live telemetry. Η κατάσταση μονάδας στο cursor υπολογίζεται από όλα τα jobs της ίδιας policy/replication· ένα παλιό selected completed job δεν περιγράφει μόνο του τη σημερινή απασχόληση.

Unit states στο replay: off_shift, available, busy/recovering, unavailable, όπως παράγονται από το event log. Run UI states: not_run, invalid_inputs, running, succeeded, failed, stale. Existing plan evaluation NOT_RUN/SUCCEEDED/FAILED και review NOT_READY/NEEDS_REVIEW/REVIEWED παραμένουν ανεξάρτητα.

Deferred entities: πραγματικό Insured/Driver/Vehicle, operational case lifecycle, holiday calendar και anomaly flags. Austin publication/update δεν μετατρέπονται σε occurrence/resolution times.

## 5. Information architecture (navigation)

Έξι κύριοι προορισμοί. Τα πέντε υπάρχοντα URLs διατηρούνται.

| Id / path | Label | Job / regions | Badge |
| --- | --- | --- | --- |
| overview /overview | Overview | Breadcrumb, σαφές mode/scope, historical KPIs και δύο υφιστάμενα charts, link στο lab | none |
| incidents /incidents | Incident history | Existing zone master-detail, filters/sorting/paging και provenance | none· totals δεν είναι actionable badges |
| capacity /capacity | Capacity lab | Persistent Assumption-based scenario label, shared settings, baseline/candidate roster, service assumptions, paired results, timeline/jobs/map | none· simulated queue δείχνεται μέσα στο run, όχι ως πραγματική εργασία |
| queues /queues | Planning queues | Existing saved plans/evaluation/review tabs· δεν είναι η modeled-job queue | Needs review από authorized count source, unknown ≠0 |
| map /map | Coverage map | Existing spatial comparison, σωστή zone σημασία, map/detail improvements | none για informational uncovered total |
| settings /settings | Settings | Προσωπικές προτιμήσεις και ξεχωριστά authorized admin configuration | none |

Shell: collapsible sidebar → rail, workspace switcher, global search με / και disable/remap preference, user menu, breadcrumb και API banner. Ίδια σειρά destinations για όλους τους ρόλους· δεν δημιουργούνται ξεχωριστά Units/Calendar/Insights pages στο bounded MVP.

Capacity lab έχει input/result context στην ίδια σελίδα. Το modeled-job table ανοίγει drawer με location map, timeline και assumptions. Full-detail/expanded-map view κρατά run/job selection και Back/Escape/focus return. Modeled selection/view state μπαίνει σε URL χωρίς ιδιωτικά στοιχεία. Μεγάλες roster/form τιμές μένουν σε validated draft/run ID, όχι σε μη ελεγχόμενο URL.

Το [console-wireframe.html](console-wireframe.html) αποτελεί low-fidelity IA review, όχι app preview. Αριθμοί δείγματος/γεωμετρικά bars είναι placeholders και όχι αποτελέσματα.

## 6. KPIs

Κάθε figure δείχνει mode, run/replication/time scope, denominator, source και assumption status. Κανένα result πριν ολοκληρωθεί matching run. Αλλαγή inputs σημειώνει το παλιό result Stale.

Στη σύγκριση εμφανίζεται ο μέσος όρος του metric ανά replication, το παρατηρημένο min/max και το πλήθος replications με ορισμένο metric. Το “mean replication p90” δεν είναι pooled p90 ούτε confidence interval. Το replay αφορά μόνο την πρώτη replication και εμφανίζει τα δικά της job/queue/response sample counts· δεν αναμειγνύεται με τους aggregate δείκτες.

| Metric | Definition / source | Drill-down |
| --- | --- | --- |
| Historical coverage / road approach | Existing historical matrix/evaluation, ίδιο cohort/threshold | Existing zone/map scope |
| Generated / completed / active / queued / unserved jobs | Event-log accounting, ίδιο horizon και replication | Modeled jobs με ίδιο outcome/status |
| Queue wait p50/p90 | Assignment minus modeled arrival, με assigned n και χωριστό unfinished/censored count | Jobs που συνεισφέρουν και χωριστό unresolved list |
| Response p50/p90 | Queue + preparation + outbound approach, με completed-arrival n και χωριστό unserved | Job timeline components |
| Target attainment | Arrivals reached by the horizon within editable response target / all modeled arrivals, including incompatible/unreachable/unserved/censored jobs | Within target / late / not reached |
| Peak queue / available capabilities | Max queue και on-duty eligible capacity από timeline | Scrub στο επιλεγμένο time bin και jobs/units |
| Unit utilization | Busy-on-duty / duty minutes· travel/onsite/recovery χωριστά, overtime explicit | Unit timeline |
| Paired difference | Candidate minus baseline με ίδιο seed/arrivals/service draws και replications | Δύο results/inputs, sample και variability |

Η ζήτηση είναι conditioned σε fixed incident count και το σύστημα αρχίζει με άδεια ουρά, ως Assumed initial state. Με μηδενικά generated jobs τα percentage metrics είναι null / Not applicable (n=0), όχι 0% ή 100%. Δεν ονομάζεται business SLA ή απαιτούμενος πραγματικός στόλος. Δεν υπόσχεται automatic optimal fleet search. Τα intervals προσομοίωσης δεν καλύπτουν όλη την parameter/data uncertainty. Άγνωστο ή missing δείχνει Not available, όχι0. Unserved/NoRoute/ασύμβατα jobs δεν εξαφανίζονται από denominators.

### Agreed assumption defaults and limits

Οι παρακάτω αριθμοί είναι **configuration conveniences, NOT empirical estimates**. Παραμένουν editable και Assumed στον ίδιο χώρο με τα αποτελέσματα.

| Shared setting | Assumed default | Bound / interpretation |
| --- | --- | --- |
| Horizon |480min|1..1440min|
| Modeled incidents |24|0..200|
| Replications |10|1..20|
| Seed |42|Validated integer; reproducible inputs|
| Response target |30min|Editable scenario target, όχι συμφωνημένο SLA|
| Arrival weights |[1,1,1,1,1,1,1,1]|Οκτώ ίσα relative bins, όχι observed hour/weekday demand|
| Preparation |3min|Editable nonnegative assumption|
| Recovery to availability |15min|Editable nonnegative full renewal allowance, όχι υπολογισμένο return route|
| Travel multiplier |1|Editable positive sensitivity factor, όχι live traffic|
| Roster size |3 baseline / editable copied candidate|1..12units ανά roster|

| Type | Assumed share | Assumed onsite triangular min/mode/max, minutes | Flatbed transport / dropoff, minutes |
| --- | --- | --- | --- |
| Battery |0.35|10 /20 /40|0 /0|
| Tyre |0.25|15 /30 /60|0 /0|
| Breakdown |0.30|20 /45 /90|20 /10|
| Collision |0.10|30 /60 /120|30 /15|

Type shares sum to1. Triangular0≤min≤mode≤max. Flatbed transport/dropoff είναι χωριστά editable nonnegative durations, όχι αντιγραμμένο outbound travel. Baseline: μία motorcycle battery/tyre, μία service van battery/tyre/breakdown, μία flatbed breakdown/collision. Όλες duty0..480 και editable home site/availability. Candidate αρχίζει ως copy ώστε η πρώτη σύγκριση να έχει ίδιες εισόδους.

Fixed-home renewal: μετά το job και transport/dropoff/recovery η μονάδα ξαναγίνεται διαθέσιμη στο configured home site. Αυτό είναι εμφανής modeled approximation. Δεν προσομοιώνεται reverse route, ενδιάμεση θέση, νέα ανάθεση καθ' οδόν ή incident→incident/site→site route. Η υπάρχουσα site→zone Car matrix χρησιμοποιείται με visible limitation· δεν αποτελεί validated truck/motorcycle routing.

## 7. List columns

- Incident history διατηρεί zone rows: Zone/id, cohort counts, modeled road time/coverage, quality/provenance. Δεν μετονομάζονται σε ασφαλισμένους ή ακριβή περιστατικά.
- Baseline/candidate roster: Unit, kind, capabilities, home site, available, duty start/end. Add/edit/remove είναι scenario actions, όχι πραγματικές εντολές στόλου.
- Service assumptions: Type, share, onsite min/mode/max, flatbed transport/dropoff, source=Assumed. Validation inline.
- Modeled jobs: Job ID, replication, type, status, approximate zone/coords, arrival minute, assigned unit, queue wait, response, service/transport/recovery και outcome. Δεδομένα από επιλεγμένο run, όχι Austin operational history.
- Comparison: Metric, baseline, candidate, paired difference, n/replications, assumption/limitation. Wireframe values Not run.

Page size25· filters/sort/page/selected run/job/time στο view state. Mobile διατηρεί Job/Type/Status/Unit, με τα υπόλοιπα στο detail. Numeric comparisons έχουν bounded horizontal table wrapper, όχι horizontal page scroll.

## 8. Detail drawer tabs

| Tab | MVP content | Honest absent state |
| --- | --- | --- |
| Summary | Modeled job/run/replication/type/status/unit | Run a scenario to inspect modeled jobs. |
| Location & map | Μεγάλο map region, selected approximate representative, coordinates/source/precision, Expand map | Location not available· text fallback όταν αποτύχει το map |
| Timeline | Simulated arrival, queued/assigned, outbound/prep, onsite, flatbed transport/dropoff, recovery/release | Not reached within horizon / pending, όχι επινοημένο completion |
| Assumptions & provenance | Service profile, scenario hashes, fixed-home rule, matrix limitations | Missing required inputs disables run with reason |

Ο πραγματικός χάρτης detail υλοποιείται μετά το wireframe OK. Το lowfi δείχνει το region, όχι λειτουργικό GPS. Full detail δίνει μεγάλο map/work area, mobile fullscreen sheet. Όταν λείπουν private data, εμφανίζεται “Insured data is not connected”; δεν προστίθεται ψεύτικος οδηγός.

## 9. Actions

| Action | MVP authority | Confirmation / outcome |
| --- | --- | --- |
| Edit shared scenario/rosters/service assumptions | Public/Analyst/Planner/Admin temporary draft | Inline validation· old result Stale |
| Copy baseline to candidate | Scenario user | Undo/local reversible action· preserves explicit changed assumptions |
| Run paired comparison | Bounded evaluator, no paid routing | No confirm for non-mutating evaluation· matching run/result only |
| Filter/scrub/select modeled job | Reader | No confirmation; selected run/time preserved |
| Save/review existing spatial plan | Existing authorized roles/server policy | Existing exact version/hash, idempotency/conflict checks |
| Change shared workspace settings | Existing Admin policy | Server-confirmed id/version/refetch |

Δεν προστίθεται πραγματικό assign/reassign/resolve incident, live roster write, driver notification ή new operational case CRUD. Αυτές οι παλαιότερες ζητήσεις διατηρούνται ως Deferred. Το simulation ακολουθεί συμφωνημένη deterministic dispatch policy: παλαιότερο pending job με διαθέσιμη συμβατή και reachable μονάδα· επιλογή πλησιέστερου directional Car approach, έπειτα stable unit ID. Blocked job δεν μπλοκάρει μονάδα που δεν μπορεί να το εξυπηρετήσει. Queue peak μετριέται μετά το dispatch και δεν περιλαμβάνει instant assignments ή immediately rejected impossible jobs. Δεν είναι ανθρώπινη πραγματική αποστολή.

## 10. Data states and real time

Σε κάθε page: loading, empty, error, unavailable, success. API outage δίνει banner και Retry, ποτέ fake/demo fallback. Unknown count≠0.

- Capacity Not run: “Configure assumptions and run a comparison.”
- Invalid: field error και specific bound. Running: progress/pending label χωρίς φτιαχτό ποσοστό. Failed: reason/code/Retry. Inputs changed: Stale result με προηγούμενα hashes, όχι νέο αποτέλεσμα.
- Empty modeled workload επιτρέπεται με incidentCount0: έγκυρο empty run, όχι missing data.
- Missing matrix/required input: Unavailable με συγκεκριμένη dependency. Roster capability gaps παράγουν modeled unserved/queued outcomes, όχι σιωπηρή παράλειψη jobs.
- Timeline scrubbing διαβάζει ήδη υπολογισμένο event log. Δεν τρέχει πληρωμένες κλήσεις ούτε δημιουργεί ψεύτικο live feed. Play paused by default, reduced motion respected.
- Historical snapshots δείχνουν source/cohort/generatedAt· private live telemetry παραμένει not connected.

## 11. Integrations that may be absent

| Integration | MVP policy |
| --- | --- |
| Austin zones/history | Existing sanitized snapshot· publication timestamp≠occurrence, source types≠synthetic service types |
| Amazon Location map / prepared matrix | Existing basemap/cache, validity/hash/provenance· paid routing builder μόνο owner, όχι scenario click |
| Capacity evaluator | `POST /v1/public/capacity-evaluations` is live in read backend3802; actual bounded evaluations verified by the deployment receipt and functional CI preview. The new console remains a candidate static build until owner release review |
| Company jobs/insured/telemetry | Deferred, not connected· no real fields/actions or synthetic fallback |
| Weather/calendar/traffic/crowding | Deferred verified adapters/forecast validation· κανένα πλαστό live layer |
| Notifications / dispatch exports | Deferred integration· no external sends in MVP |
| Product RAG/Bedrock KB | Deferred· existing local research retrieval is documentation tooling only |

## 12. Language, locale and time zone

UI/code English, chat/review Greek. System fonts, Unicode notes/search. Existing America/Chicago and UTC preference remain. Capacity time axis uses minutes since scenario start, with horizon/bin boundaries explicit; these are not actual incident occurrence times. Any civil start label has zone/UTC offset. No future holiday implication from a scenario date/name. Interval semantics [start,end), overnight/DST handled explicitly in any future dated operational adapter. Existing en-US numeric formatting, minutes explicit; no invented savings/currency KPI.

## 13. Existing design system

Route A retains React/Tailwind tokens/router/TanStack components. Dark navy/cyan default, light-theme QA. Correct native dropdown option surfaces/focus/disabled/error states; complex combobox only if justified. Avoid clipping menus by table/drawer containers.

WCAG2.2AA target: visible focus, keyboard drawer tabs, Back/Escape returns focus, labels beyond color, reduced motion. / shortcut has disable/remap. Native number/select controls and keyboard alternative to scrub. Charts/timeline have a readable table alternative. 320/390/768/1440 widths, existing375 regression coverage retained. Fullscreen mobile detail, same breakpoint for shell/table, horizontal scroll only inside numeric tables. Map geometry/pixels and dropdown-open states require actual visual QA later.

## 14. Stack and hosting constraints

Existing React/TypeScript/Tailwind/TanStack Table/MapLibre/react-router stack and AWS serverless boundary remain. No fresh scaffold. Pure-domain simulator, explicit contracts/adapters and no duplicated enums/defaults between domain/API/UI. Validated request limits and bounded execution; result provenance binds scenario/model/dataset/matrix/seed/policy inputs. Results remain transient with no-store responses; a new result cache is unnecessary for this bounded MVP. Browser replay does not recalculate physics or retrieve paid route legs.

Preserve public evaluator versus authorized writes, Cognito tenancy, raw/provider-data privacy/expiry, concurrency/idempotency/review checks. Domain/API work can proceed independently under current owner instruction. Wireframe structure is explicitly approved. Shell/overview and first-list review checkpoints still apply in order before further pages.

No npm/pip/Playwright installation locally; heavy build/tests in CI. Scripts run with --help before use at their step. This brief/wireframe step uses no skill scripts and modifies no skill file. USD25total remains approved; no new routing, cloud resource, paid voice or video production here. Existing five-page release stays live until replacement verification.

## 15. Demo data and honesty labels

The owner approved **Assumption-based scenario** mode, not a synthetic insured-person workspace. Persistent badge and title identify the Capacity lab and every modeled result. Real Austin historical views remain separately labelled Observed/Derived historical data.

- Modeled job type, arrival time, service duration, fleet, shifts and capability mapping are assumptions/synthetic outputs. Spatial sampling may use real zone weights; that does not make generated jobs real incidents.
- Default numbers are visible editable conveniences. No measured resolve time, predicted Christmas demand, achieved SLA or validated staffing requirement is claimed.
- Fixed-home/recovery and Car-routing limitations appear beside settings/results. Shared baseline/candidate random streams support a paired experiment, not a real-world causal proof.
- Failed real reads never switch modes. IDs/caches/stores/denominators keep scenario jobs separate from historical zones and future private records.
- No real insured/contact/policy/plate/VIN data is necessary or approved. Any future authorized private adapter needs its own field-level policy, data rights and review.
- Wireframe is marked “IA review / Illustrative placeholders”; gray bars, sample table IDs and sample badges are not run outputs.

## 16. Open questions

Resolved by latest owner instruction: Q1 no private insured data required; Q2 explicit editable assumptions approved; Q3 scenario target input is assumption, not business SLA; Q10 bounded scope agreed, proceed to wireframe.

| Item | Status / default | Blocks what |
| --- | --- | --- |
| W1 wireframe structure | **OWNER APPROVED** six destinations, Capacity lab regions and detail/map | Resolved; shell/overview subsequently approved |
| W1b shell/overview preview | **OWNER APPROVED** source67673a8 and verified desktop/mobile preview | Resolved |
| W1c first functional list/detail | **OWNER APPROVED** by 2026-10-31 instruction «Συνέχισε τις εργασίες» after source2ce3156 and its verified list/detail images | Resolved; Step5 final QA proceeds |
| W1d final contact sheet | Owner explicitly answered «Εγκρίνω το UI» for the1e5efce contact sheet, mobile unit map and recovery card | **OWNER APPROVED**; human keyboard/role/native-popup checks remain separate |
| W2 final field/enum/bounds mapping | Resolved in `packages/contracts/src/capacity.ts`; defaults factory shared with future UI; domain/API typecheck/tests/build passed in CI41110905525 | UI must consume this single contract |
| W3 real staffing targets / service logs | Deferred; editable scenario target/durations are sufficient for this MVP | Any real-world staffing/SLA claim |
| W4 private insured/driver/telemetry | Deferred, no source needed now | Real operational integrations only |
| W5 calendar/weather/anomalies | Deferred pending adequate joint data/support/validation | Empirical seasonal views/detector claims |
| W6 capture/video/publication | Existing independent owner gates remain pending | Public upload/submission and new video production |
| W7 bounded Bedrock/Strands copilot | Owner answered «Πρώτα units και towing» | **RESOLVED: deferred from the current increment**; no AI runtime/service activation |

No open item authorizes guessed measurements. Engine runtime limits and actual outputs must be measured by CI before claims/deployment.

## 17. Decisions

| Date | Decision | Who / basis |
| --- | --- | --- |
|2026-10-30|Route A / adapt retained|Prior explicit owner approval|
|2026-10-30|Research incorporated into bounded mixed-fleet/concurrent-job/queue/service-time/what-if MVP|Latest explicit owner instruction|
|2026-10-30|Assumption-based scenario mode agreed; no private insured data prerequisite|Latest owner scope decision|
|2026-10-30|Configured defaults/bounds in section6 remain editable Assumed, not estimates|Coordinator/domain implementation contract|
|2026-10-30|Fixed-home renewal with explicit recovery; no invented reverse/moving routing|Bounded domain contract and matrix limitation|
|2026-10-30|Preserve five routes and propose sixth Capacity lab, with no new Units/Calendar/Insights nav|Owner approved wireframe structure in latest explicit reply|
|2026-10-30|C01-C14 retained with explicit MVP/deferred trace|Owner requests and research synthesis|
|2026-10-30|No real dispatch/PII, no claimed SLA, no forecast/anomaly/product-RAG deployment|Agreed bounded scope and source limits|
|2026-10-30|Wireframe structure explicitly approved: «Εγκρίνω τη δομή του wireframe»|Owner reply; Step3 complete|
|2026-10-30|Step4 starts with shell/overview preview; Capacity list/detail follows owner review|ops-console-ui Step4 named checkpoint|

Required next gate from [ops-console-ui/SKILL.md](C:/Users/tf/.claude/skills/ops-console-ui/SKILL.md), step5: “The user looks at the contact sheet with you and names anything that reads wrong to them.” Wireframe, shell/Overview and first functional list/detail are approved. Human keyboard and role judgment from references/qa-checklist.md remain pending and cannot be inferred from automated tests. Modeled jobs are not empirical insured incidents.

### Step4 shell/overview review record

- Real: the new UI reads the actual existing public AWS config/manifest/zones and historical coverage evaluator. Preview receipt binds source `67673a8d8677c3582b56ca6caf6d394e32b98455` to live API release `5ad96cc4c6e50503556bb706f1698477764d2dd2`. This is a CI preview, not a deployment.
- Verified: [CI41118994064](https://github.com/upgradedev/standby/actions/runs/41118994064) passed typecheck, `npm test`44domain/API tests, source/data/demo gates, web/Lambda build and the Step4 preview. Copied skill lint on Shell/Overview has0errors/0warnings. Six shots at320/390/1440, dark/light;0console errors,0failed normal requests,0ready timeouts,0keyboard smoke warnings. Additional checks cover persisted rail, native dropdown, user dropdown, mobile navigation/Escape/focus return and a forced API outage without KPI fallback.
- Review artifacts: [CI preview artifact](https://github.com/upgradedev/standby/actions/runs/41118994064/artifacts/13008140431), local `.runtime/console-review-67673a8/` with contact sheet, full desktop, mobile, dropdown and forced-error PNGs. Coordinator visually inspected the contact sheet, desktop/mobile, dropdowns and outage. Images are actual app captures.
- Demo: no made-up historical data or outage fallback. Capacity lab currently shows an explicit scope/unavailable preview only; its editable scenario forms, queue/jobs/map and API connection follow the owner shell/overview OK.
- Open: shell/overview now explicitly approved; Capacity first-list/detail review; full-app strict lint, axe and human keyboard/role/deep-link/state release matrix. The copied skill scripts remain byte-identical to their source, verified with SHA256. No local package installs, cloud deployment, paid routing, video or publication in this increment.

### Step4 functional Capacity increment

- Owner explicitly approved shell/Overview and authorized functional forms, queue and detail/map. First-list implementation uses the real public Capacity API. Source2ce315602c32f60255812ecc48f653df1d5df227 passed [CI41130833000](https://github.com/upgradedev/standby/actions/runs/41130833000), including53 tests, builds and20 functional captures.
- Existing web UI remains5ad. The read API is partially activated at3802 with capability metadata, bounded actual evaluations and rollback receipts; no new resources, paid routing or protected writes.
- Next owner checkpoint: review the generated jobs list, all detail tabs and full/expanded map. Full release QA and later video/publication approvals remain separate.

- Verified first-list record:10 browser checks,3 actual successful Capacity evaluations,1 actual400 boundary rejection and1 deliberate network abort. Identical plans have zero paired changes; candidate+1 preserves baseline/shared samples;0jobs retainsN/A observations. Filters/sort/pagination, exact recorded peak, four tabs, Escape/focus return, light/dark and1440/390 reflow pass. Actual AWS map geometry/pixels pass at normal/expanded/mobile sizes with live CSP preserved.
- Real: geography, prepared directional Car road snapshot and server-computed modeled results. Assumed: arrivals/type mix/service/recovery/rosters/shifts. No private insured records or product demo-data fallback. UI preview is not a web deployment; read backend3802 is live, existing web5ad stays intact.
- First list/detail is owner-approved. Full release QA is underway; owner Step5 contact-sheet review is now approved; human keyboard/role judgment and OS-native dropdown popup inspection remain pending. Small mobile word-wrapping was corrected and reverified after visual review.


### Step5 unit-location/towing follow-up — 2026-10-31

Unit pins show evaluated resident IDs/counts and assumed home sites. Locate is separate from draft availability. Empty-site labels appear on hover/focus/selection; occupied IDs stay visible. Native pin clicks no longer also select the polygon below. Capacity detail shows current unit phase, one-car payload, dispatch reservation and later active-job context. Two overlapping tows serialize on one flatbed through unloading/recovery; payload1 during transport/unloading becomes0 during recovery while dispatch stays busy.

[PRIMARY] Source1e5efcea81f83ebc15398df973ced74e1cc325a3: https://github.com/upgradedev/standby/actions/runs/41187469472 SUCCESS (`gh run view 41187469472 --json headSha,status,conclusion`). Hosted npm tests71/71, build/typecheck, strict UI lint and existing gates passed. Fresh matrix receipt has86 mandatory axe scans/0failed/0missing/0violations. Full anonymous1440/768/375 acceptance passed Locate/Back, exact colocated IDs, URL/draft isolation and unchanged actual-map geometry/RGB gates. Dedicated towing proof is PASS:1actual synthetic API evaluation,0new paid route builds,5mandatory axe scans/0violations and6screenshots. Reproduce counts with `json.load` on integration `.runtime/unit-towing-followup-checks.json`, `.runtime/console-qa-review-1e5efce/receipt.json` and `.runtime/towing-review-1e5efce/receipt.json`.

Workshop destination/routing/queue, actual GPS and next dispatch from a workshop are NOT connected. Transport/drop-off/fixed-home recovery are visible editable allowances. No staffing guarantee or AI runtime was added. Existing web5ad/read3802 and USD25total remain unchanged; this is not a frontend deployment. Renewed ops-console-ui Step5 owner contact-sheet review is APPROVED. Human keyboard/role/native-popup and axe incomplete judgments remain pending. Video/publication remain separate; copilot is deferred by owner decision.

Failure evidence remains retained: a9f9eb5 wrong exact job-link name;401c3c9/b5ce34e native pin event bubbling and visible empty-label overlap;6ebad3f repeated-drawer instrument timeout after unloading. The harness now waits for both native closure and selected-job URL teardown before the next scrub/open. The subsequent full run passed without widening timeouts, axe or map gates. Precise original timeout await was not established before the stronger barrier; no unsupported app-bug claim is made.

Review packages: integration `.runtime/console-qa-review-1e5efce/` and `.runtime/towing-review-1e5efce/`. Six destinations/four tabs and renewed owner visual review are APPROVED. Human release judgments are separate.

### Step5 candidate release record - 2026-10-31

Qualified application source `db67b6d0a2455549736be0d6574c184309fe0277`: [full CI](https://github.com/upgradedev/standby/actions/runs/41195126428) SUCCESS. Release artifact [13040351664](https://github.com/upgradedev/standby/actions/runs/41195126428/artifacts/13040351664). `gh run view 41195126428 --repo upgradedev/standby --json headSha,status,conclusion,jobs` verifies all required jobs; optional authenticated operator_qa is skipped in this run.

- Build/typecheck and npm tests: exit0,71/71 npm tests. Existing separate source/data/research/media validators also pass;71 is not an aggregate of all validators.
- Strict UI lint: exit0,0errors/0warnings over29console files. One intentional `unavailable-state` suppression applies only to fixed skeleton placeholders in ui.tsx; DataGate owns terminal source states.
- Authoritative route matrix: exit0,86captures and mandatory axe4.11.0 scans,0failed/0missing/0violations. Six routes at320/390/768/1440 in dark/light with forced loading/error/malformed/unavailable/no-match/partial-source/missing-capability/storage-blocked cases. Actual map geometry/RGB checks pass. Normal paths have0unexpected errors and54non-React console-warning events on map views, retained in report. Deliberate faults are recorded as forced, not counted as normal success.
- Towing: exit0,1actual synthetic Capacity API evaluation,0new paid route builds,5mandatory axe scans/0violations,6screenshots. Two simultaneous tows serialize on one flatbed through unloading/recovery; payload1 during transport/unloading and0 but busy during recovery. Older selected job cannot hide a later active unit assignment. Four repeated close checks satisfy the unchanged URL/native/React/semantic25s gate in42/38/41/46ms in this run; no performance SLA is inferred.
- Anonymous journey: exit0, desktop1440/tablet768/mobile375. Actual source/chart counts, evaluated resident IDs, native Locate/site/Back, URL/draft isolation, unit-unavailable comparison, history filters/sort/pagination/search/detail, local persistence/reload, preferences and outage/recovery pass. Input slash filtering is committed before the clear operation; the existing15s conditions remain.
- Functional Capacity preview: exit0,10checks/20screenshots,3actual successful evaluations,1actual400 boundary rejection and1deliberately aborted request. PR merge source63c64bce9d01fbf843c265f9914d5571dc772500 has exactly the same git treec6b1959bc4f718fe93b9364e7d801a9d4ce5636f as qualified head (`gh api .../git/commits/<merge>`; `git rev-parse <head>^{tree}`). Actual normal/expanded/390 map pixels pass; source receipts retain the honest merge identifier.
- Historical role/API acceptance: [CI41181026025](https://github.com/upgradedev/standby/actions/runs/41181026025), source2bbe2d5. Actual Cognito/PKCE, signed memberships, Analyst/Planner/Admin server401/403, plan create/idempotency/evaluate/review, Admin settings CAS/refetch, workspace return/Back and client-expiry teardown passed then. Auth/API paths are unchanged by this increment; it is not a new human role judgment. Synthetic users/memberships/workspace/results/local credentials and temporary GitHub secret were removed with retained cleanup receipts.
- Human visual review by coordinator: both fresh contact sheets, every normal390dark route, light map1440/390, all six towing images and functional normal/expanded/mobile detail maps inspected. Home label remains inside the real map; geographic point/camera constraints are unchanged. Owner Step5 design approval at1e5efce remains recorded; these corrected maps accompany the next Step6 exact-source decision.
- Human keyboard1440/390, human role-menu judgment, native OS dropdown popup pixels and axe incomplete gradient/short-number/empty-table judgments: **PENDING**. Automated smoke/axe/API tests do not constitute human attestation or whole-app WCAG certification.
- Evidence: integration `.runtime/unit-towing-final-checks.json`, `.runtime/console-qa-review-db67b6d/` (normal/states sheets, report, receipt and individual shots), `.runtime/towing-review-db67b6d/` and `.runtime/capacity-review-db67b6d/`. Counts are reproduced with `json.load` of these receipts; sanitized CI PASS lines are included in final-checks. Every earlier failed receipt/image remains intact.
- Deployment: pre-deploy qualification above had no cloud write. The owner has since approved the exact db67b6d controlled preview; it is now DEPLOYED and post-deploy verified as recorded below. Backend/config remain3802. No API/model/routing gate was widened; video/Builder publication remains separate.

### Step6 owner handover - approved preview deployed 2026-10-31

The owner explicitly approved the exact `db67b6d0a2455549736be0d6574c184309fe0277` controlled frontend preview with rollback. [Actual preview](https://d34x1513u5u1qs.cloudfront.net/capacity). Deployment receipt: integration `.runtime/frontend-release-db67b6d-attempt2/receipt.json` PREVIEW_DEPLOYED_VERIFIED. All22served file hashes match the original approved manifest; actual /capacity/root entry, unchanged config/backend3802, distribution configuration and security headers pass. Reproduce with `json.load` of receipt/plan and their key-to-sha256 maps. Original proposal remains immutable; its earlier PENDING field is superseded by separately hash-bound owner-approval.json.

- **Real:** config/health, public manifest/zones, placement and Capacity evaluation APIs, AWS basemap and prepared directional Car approach snapshot. [Post-deploy acceptance](https://github.com/upgradedev/standby/actions/runs/41200012209) SUCCESS at1440/768/375, NO static UI overlay and no operator credentials. Test source59bccb0 changes only STATE/LOG/brief from applicationdb67b6d (`git diff --name-only db67b6d 59bccb0`). Protected workspace role/API evidence remains historical2bbe2d5. The root additionally used the deployed Chrome UI to run2modeled collisions in1replication with one compatible flatbed: second job queues; first clears191.7min but dispatch remains busy through201.7, with payload0 during recovery at197min. This is1Run-button action; network count was not independently instrumented. Chrome screenshots/AX and safe CI PASS lines are bound in `.runtime/live-preview-db67b6d/verification.json`.
- **Demo/assumed:** no `data/demo-data.ts`, `DEMO_MODE` or fallback operational dataset. Capacity workload/type mix/service/rosters/shifts remain permanently labeled editable assumptions computed by the real API. Transport/drop-off/fixed-home recovery are assumed allowances. Insured/driver/garage/GPS records, routed towing and dispatch from a workshop are not connected; no staffing guarantee or live dispatch is claimed.
- **Open items:** human keyboard1440/390, human role-menu judgment, OS-native dropdown popup and axe incomplete judgments before final release; remaining integrations named above; separate video exact text/shot-list and public video/Builder submission approvals. Automated/agent checks do not constitute human attestation. One intentional fixed-skeleton unavailable-state lint suppression remains documented; DataGate owns terminal states. Non-React map warning categories remain visible in the matrix report.

The first apply encountered the publisher's incorrect PublishFunction ETag assumption and performed a VERIFIED rollback to the old served entry/absent theme/old function. Its failed receipt and exact publisher remain at `.runtime/frontend-release-db67b6d/`. The corrected publisher reads GetFunction(LIVE) for ETag. Attempt2 preserves the original approved manifest and binds refreshed function ETags only to our own verified rollback receipt, old code/config/index and publisher hashes. Read-only preflight, wrong-approval negative control and independent drift/ownership/rollback review passed before apply. Both failure and success records are retained; no gate was relaxed.

The approved change scope was only22web files and `/capacity` in the existing dedicated viewer function. Backend/config/Lambdas/IAM/Cognito/source/cache data were not changed by this preview. Exact rollback backups remain available; broad tools/publish.py was not used. No video/Builder publication or submission terms acceptance occurred.

The invoked [ops-console-ui skill](C:/Users/tf/.claude/skills/ops-console-ui/SKILL.md), Step6, says **"The user decides the open items and when to switch `DEMO_MODE` off."** The controlled-preview decision is COMPLETE. Route A has no DEMO_MODE switch; human release judgments and later video/publication decisions remain open. The Chrome preview is left for the owner to inspect.

Actual endpoint inventory (API prefix `/api/v1`):

| Surface | Real read/write paths | Scope |
| --- | --- | --- |
| Bootstrap/readiness | `GET /config.json`; `GET /api/v1/health` in QA; `GET /api/v1/public/manifest` and `/zones` | Actual source/config; readiness has HTTP/status/release checks |
| Coverage | `POST /api/v1/public/evaluations` | Stateless hypothetical placement over the prepared directional Car snapshot |
| Capacity lab | `POST /api/v1/public/capacity-evaluations` | Actual bounded simulation; arrivals/types/service/roster are explicit assumptions, not operational incidents |
| Membership/plans | `GET /api/v1/workspaces`; GET/POST `/api/v1/workspaces/:w/plans`; GET `/:plan`; POST `/:plan/evaluate` and `/:plan/review` | Existing protected placement-plan workflow, not live dispatch or saved Capacity runs |
| Workspace settings | GET/PATCH `/api/v1/workspaces/:w/settings` | Admin/CAS write with same-scope server refetch confirmation; historical actual-role proof remains source2bbe2d5 |

No `data/demo-data.ts` or `DEMO_MODE` runtime exists in this Route A console (`rg` on apps/console/src). There is no demo fallback to switch off; simulation inputs remain permanently labeled assumptions.

Final bounded lifecycle correction1aab618: retain one lazy MapSelection within [scopeKey,view,runKey,generatedAt,datasetHash], not old job/card content. Native close and inactive tabs hide the same map; invalid raw selection/run/geography immediately blocks and clears geometry. Positive-size initialization/resize/fit only; teardown remains on scope/result/page/config/retry/invalid-selection exits. All existing clear-title/0cards/hidden/URL/25s/map/axe limits stay required. The current history test also waits for committed slash filtering before issuing its clear, retaining15s checks and actual source-derived expected data. Fresh CI/captures and owner exact-source preview approval are complete; guarded preview deployment and post-deploy acceptance passed. Human release judgments remain pending.
