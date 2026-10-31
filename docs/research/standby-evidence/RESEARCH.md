# Standby: έρευνα αγοράς και τεκμηρίωση μελετών

30/10/2026. Research synthesis για τη σχεδίαση της επόμενης έκδοσης. Ο owner ενέκρινε το περιορισμένο MVP μικτού στόλου, ταυτόχρονων περιστατικών, ουρών, διαφορετικών χρόνων εξυπηρέτησης και what-if με εμφανείς επεξεργάσιμες παραδοχές. Η παραγωγική εφαρμογή παραμένει στο5ad96cc μέχρι να επαληθευτεί η αντικατάσταση. Η έγκριση της δομής του νέου wireframe εκκρεμεί. Οι προτάσεις παρακάτω δεν αποτελούν απόδειξη υλοποιημένων λειτουργιών ή μετρημένων επιχειρησιακών αποτελεσμάτων.

Το βασικό συμπέρασμα είναι ότι χρειαζόμαστε κοινή αξιολόγηση χωροθέτησης, χρονικής ζήτησης και απασχόλησης πόρων. Ο χάρτης ιστορικής προσβασιμότητας αποτελεί χρήσιμο baseline. Η εκτίμηση επάρκειας στόλου χρειάζεται επιπλέον αφίξεις εργασιών, συμβατές μονάδες, χρόνους απασχόλησης, βάρδιες και σαφείς επιχειρησιακούς στόχους.

Η επιλεγμένη βάση περιλαμβάνει26 πρωτογενείς πηγές:9 αγοράς,10 ερευνητικές και7 δεδομένων/μεθόδων/platform documentation. Τα πλήθη παράγονται με `python retrieve.py --validate`. Για τις ερευνητικές πηγές,5 διαθέσιμα πλήρη κείμενα εξετάστηκαν στα σχετικά τμήματα και5 έχουν μόνο abstract/preview. Το επίπεδο πρόσβασης διατηρείται σε κάθε record. Πρόκειται για στοχευμένη έρευνα, όχι εξαντλητική συστηματική ανασκόπηση ή ανεξάρτητο product benchmark.

## Η αγορά έχει ήδη σχετικές προσεγγίσεις

| Παράδειγμα | Τι τεκμηριώνει η πρωτογενής πηγή | Συνέπεια για το Standby |
|---|---|---|
| Agero/Swoop | Matching με εξοπλισμό, διαθεσιμότητα, ουρά εργασιών και predictive ETA. [Product explanation](https://blog.agero.com/who-services-matters-optimizing-dispatch-through-intelligent-truck-location-and-job-availability) | Η κοντινότερη μονάδα δεν είναι κατ’ ανάγκη η κατάλληλη ή η πρώτη που θα ελευθερωθεί. |
| Swoop Insights | Territory-demand maps και simulator αναδρομικών job offers με αλλαγές completion/NPS/cost. Το FAQ ορίζει ημερήσια ανανέωση. [Help hub](https://info.agero.com/insights-dashboard-hub) | Το overlap είναι μερικό. Αυτός ο simulator δεν τεκμηριώνεται ως προσομοίωση ουράς/επάρκειας στόλου. |
| Interamerican, Ελλάδα | Μικτός στόλος, εξειδικευμένες υπηρεσίες και αυτόματη ανάθεση κατάλληλου μέσου. [Επίσημη σελίδα](https://www.interamerican.gr/idiotes/proionta-ypiresies/oxhmata/asfaleia-odikhs-bohtheias/) | Χρειάζεται vehicle/job capability model και για το ελληνικό business σενάριο. |
| RAC | Εξειδικευμένα tyre patrols σε περιοχές με υψηλό breakdown volume. [Our Patrols](https://www.rac.co.uk/business/breakdown/our-patrols) | Η χωροθέτηση πρέπει να εξετάζεται ανά δυνατότητα εξυπηρέτησης. |
| Allianz Partners India | Ανακοίνωση weather-prediction partnership με στόχο προληπτικό resource planning. [Ανακοίνωση](https://www.allianz-partners.com/en_IN/in-the-news/press-releases/Allianz-Partners-India-Announces-Partnership-with-CI-Metrics-to-Enhance-Predictive-Weather-Based-Automotive-Assistance-Solutions.html) | Υπαρκτή κατεύθυνση αγοράς, χωρίς δημοσιευμένη εδώ επαλήθευση accuracy ή μείωσης αναμονής. |
| Towbook / Omadi | Status timestamps και exports, καθώς και συνδυασμός unassigned jobs, drivers/trucks και map. [Towbook](https://towbook.ghost.io/towbook-element-driver-activity-report/), [Omadi](https://omadimobilemanagement.zohodesk.com/portal/en/kb/articles/dispatch-das) | Πηγή απαιτήσεων για το console και πιθανό authorized integration με τον dispatcher που ήδη χρησιμοποιεί ο πελάτης. |

Οι περιγραφές προϊόντων τεκμηριώνουν δημοσιευμένες δυνατότητες, όχι ανεξάρτητα αποτελέσματα. Η Agero ανακοίνωσε ολοκληρωμένη εξαγορά της Urgently στις28/4/2026· δεν παρουσιάζονται ως ανεξάρτητοι όμιλοι. [Πηγή](https://blog.agero.com/why-agero-and-urgently-are-better-together)

**Πρόταση τοποθέτησης προϊόντος, ως υπόθεση προς επιβεβαίωση:** planning companion για περιφερειακό operator οδικής βοήθειας με δικό του ή συμβεβλημένο στόλο. Trigger: προετοιμασία βάρδιας, αλλαγή roster ή απώλεια μονάδας. Απόφαση: πού περιμένει κάθε συμβατός πόρος και ποιο ρίσκο ουράς/καθυστέρησης αφήνει το πλάνο. Έξοδος: ελεγχόμενο shift plan που μπορεί να περάσει στον υπάρχοντα dispatcher. Η προθυμία πληρωμής, η πρόσβαση σε δεδομένα και το κόστος της σημερινής διαδικασίας παραμένουν ανεπιβεβαίωτα. Δεν τεκμηριώνεται claim «πρώτο παγκοσμίως» ή απουσίας ανταγωνιστών.

## Ποιες μελέτες αλλάζουν τη σχεδίαση

| Προσέγγιση / πηγή | Τι αξιοποιούμε | Όριο μεταφοράς |
|---|---|---|
| MCLP, Church–ReVelle1974 | Διαφανές fixed-fleet spatial baseline και καμπύλες fleet/coverage, με δυνατότητα περιορισμού των χειρότερα εξυπηρετούμενων περιοχών. [Πλήρες αρχικό paper](https://people.geog.ucsb.edu/~forest/G294download/MAX_COVER_RLC_CSR.pdf) | Δεν περιλαμβάνει busy units ή ουρές. |
| MEXCLP / Batta etal1989 | Η πιθανότητα μη διαθεσιμότητας επηρεάζει την αναμενόμενη κάλυψη. [Publisher abstract](https://pubsonline.informs.org/doi/abs/10.1287/trsc.23.4.277?journalCode=trsc) | Ίδια busy probabilities και ανεξαρτησία είναι ισχυρές παραδοχές. Δεν προκύπτει επάρκεια μικτού στόλου. |
| Pal–Bose2009 | Reliability, depot/vehicle allocation και κόστος σε roadway response. [Author record/abstract](https://hub.hku.hk/handle/10722/86057) | Abstract-only· δεν αναπαράγουμε άγνωστη πλήρη διατύπωση ή numerical results. |
| Lou etal2011 / Wu etal2014 | Patrol allocation και event simulation με arrivals, dispatch/routing και clearance. [Lou](https://www.sciencedirect.com/science/article/pii/S0968090X10000987), [Wu](https://www.sciencedirect.com/science/article/abs/pii/S1569190X14000501) | Preview/abstract-only· freeway patrol διαφέρει από αστική ασφαλιστική οδική βοήθεια. |
| VDOT SSP-OPT2023 | Συνδυάζει frequency/duration models και simulation για patrol configurations. Χρόνοι εργασίας διαφοροποιούνται ανά τύπο και χρονικό πλαίσιο. [VTRC24-R5](https://rosap.ntl.bts.gov/view/dot/68898/dot_68898_DS1.pdf) | Τοπική βαθμονόμηση. Incident-level first-arrival/last-departure duration δεν ισούται υποχρεωτικά με busy time κάθε μονάδας. |
| Schmid–Doerner2010 / Jánošíková etal2021 | Χρονικά μεταβαλλόμενοι δρόμοι/ζήτηση, relocation cost, πλήρης κύκλος απασχόλησης και αξιολόγηση διαφορετικών στόχων με simulation. [2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC2982752/), [2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8254255/) | Μεθοδολογικές αναλογίες EMS. Δεν μεταφέρουμε medical thresholds, διάρκειες ή ποσοστά βελτίωσης. |
| Yang2023 | Υποψήφια calendar/weather χαρακτηριστικά και lagged precipitation. [Πλήρες άρθρο](https://onlinelibrary.wiley.com/doi/10.1155/2023/6648740) | Μικρά strata και εν μέρει μη prospective split. Δεν υιοθετούμε universal Christmas multiplier. |
| Micolta2026 | Σύγκριση patrol/staged/hybrid ανά τμήμα, χρόνο και κατεύθυνση. [Διατριβή, abstract](https://digitalcommons.fau.edu/etd_general/416/) | PDF403, άρα abstract-only. Deterministic corridor results δεν αποδεικνύουν stochastic staffing sufficiency. |

Η προτεινόμενη τεχνική επιλογή είναι **υφιστάμενο spatial baseline + μικρός seeded discrete-event simulator**. Το numerical solver παραμένει ντετερμινιστικό. Οι μελέτες καθοδηγούν τη δομή και τους ελέγχους· οι παράμετροι πρέπει να προέρχονται από τον συγκεκριμένο operator ή να εμφανίζονται ως Assumed.

## Το κρίσιμο data contract

Το [επίσημο Austin schema](https://data.austintexas.gov/api/views/dx9v-zd7x.json) έχει published/update timestamps και αναφερόμενα traffic issues, όχι driver/insured, dispatch/arrival/service/available-again events. Δεν υπολογίζουμε διάρκεια επισκευής από archived−published και δεν αντιμετωπίζουμε το feed ως όλες τις κλήσεις ενός operator.

Για την επόμενη έκδοση προτείνεται event log με pseudonymous job/unit IDs, τύπο και απαιτούμενες δυνατότητες, θέση, reported/dispatched/accepted/arrived/service-completed/scene-departed/dropoff-completed/available-again timestamps. Χωριστά shift/break intervals, κατάσταση μονάδας και freshness τοποθεσίας. Unknown στοιχεία μένουν null. Οι ορισμοί arrival, lanes-open και scene-clearance πρέπει να διακρίνονται, όπως δείχνει το [FHWA TIM guidance](https://ops.fhwa.dot.gov/tim/preparedness/tim/performance_measures.htm).

Ο χρόνος δέσμευσης μονάδας περιλαμβάνει όσα στάδια την καθιστούν μη διαθέσιμη: προετοιμασία, προσέγγιση, εργασία, ενδεχόμενη ρυμούλκηση/παράδοση και απαιτούμενη επαναφορά. Η πολιτική ορίζει αν μπορεί να ανατεθεί νέα εργασία κατά την επιστροφή. Τα service profiles ανά type/unit χρειάζονται δείγμα, πηγή, version και κανόνες missing/censored records. Μέχρι να υπάρχουν logs, χρησιμοποιούνται εμφανή low/base/high assumptions.

**Ενδεικτικό αριθμητικό παράδειγμα, όχι δεδομένα Austin:**6εργασίες/ώρα με μέσο συνολικό busy cycle45λεπτά προσφέρουν4,5unit-hours εργασίας ανά ώρα. Τρεις μονάδες δίνουν aggregate load ratio1,5. Σε απλό ομογενές σταθερό σύστημα χωρίς απώλειες αυτό υπερβαίνει τη μέση χωρητικότητα. Ακόμη και ratio κάτω από1 δεν εγγυάται tail-wait/SLA ή επάρκεια ειδικού τύπου οχήματος. Η ακριβής συμπεριφορά εξαρτάται από διακύμανση, ουρές, βάρδιες, συμβατότητες και πολιτική ανάθεσης. Το παράδειγμα αναπαράγεται με `6 * (45/60) / 3`.

## Συγκεκριμένη σειρά υλοποίησης

| Προτεραιότητα | Increment μετά τη συμφωνία του brief | Τι αποδεικνύει / dependency |
|---|---|---|
| 1 | Data adapters και event/capability schema, provenance ανά πεδίο | Διαχωρίζει observed reports, ιδιωτικά operational logs και synthetic/assumed scenario inputs. |
| 2 | Bounded DES: arrivals → eligible assignment/queue → travel → service → release | Χειρίζεται overlap, shifts/breaks και διαφορετικό busy cycle. Καμία διπλή ενεργή ανάθεση. Χρειάζεται συμφωνημένη dispatch policy. |
| 3 | Scenario comparison για fleet size/type/shift και unavailable-unit stress | Ίδιες αφίξεις και random draws ανά σύγκριση. Εμφανίζει πόσο αλλάζει η ουρά και ποιες περιοχές/τύποι μένουν πίσω. |
| 4 | Linked time bars και map replay από το παραγόμενο event log | Scrubbing σε ήδη υπολογισμένο run· οι μπάρες δείχνουν ζήτηση, backlog και διαθέσιμες δυνατότητες. |
| 5 | Calendar/weather και διαφανές anomaly baseline | Μόνο με κοινά zone×local-date×time δεδομένα, support και freshness. Αρχικά aggregation/pooling σε επαρκώς μεγάλα buckets. |
| 6 | Περιορισμένη relocation/hybrid policy και RAG explanation panel | Κόστος/χρόνος μετακίνησης και movement limits· εξήγηση προκύπτει από versioned result + σχετικές πηγές. |

Για το αρχικό simulation συγκρίνουμε μικρή shortlist από depot/spread/υπάρχον proposal και λίγες βελτιωμένες εναλλακτικές. Δεν χρειάζεται GPU, deep RL ή μεγάλος MILP solver. Οι ακριβείς runtime/run-count περιορισμοί θα μπουν στο agreed implementation contract και θα μετρηθούν πριν από deployment.

Η υπάρχουσα μήτρα είναι traffic-independent Car και site→zone. Δεν διπλασιάζουμε τον χρόνο για να επινοήσουμε directional επιστροφή, ούτε παρουσιάζουμε Car travel ως truck-feasible routing. Missing return/tow legs απαιτούν χωριστές εμφανείς παραδοχές ή επαληθευμένη νέα μήτρα. Relocation χρειάζεται site→site travel. Εάν επιτρέπεται νέα ανάθεση κατά την επιστροφή, χρειάζεται και current-position/incident→next-incident travel. Κάθε μη υποστηριζόμενο leg παραμένει εμφανής περιορισμός ή assumption. Δεν έγιναν νέες routing κλήσεις.

Στο AWS design προτείνεται μικρό pure-domain simulator, bounded execution σε κατάλληλο worker, private S3 event/result snapshots και content-addressed caching με dataset/matrix/model/policy/seed hashes. Ο browser διαβάζει το event log για το replay. Η υπάρχουσα διάκριση anonymous evaluation και authorized workspace writes διατηρείται. Είναι πρόταση αρχιτεκτονικής, χωρίς νέα resources ή deployment στην παρούσα εργασία.

## Metrics και views που αξίζουν

Το view χωροθέτησης κρατά historical reach και uncovered zones. Το capacity view προσθέτει queue delay, travel-to-scene, total request-to-arrival, p50/p90, service duration, διαθέσιμες συμβατές μονάδες, utilization ανά μονάδα/τύπο, peak backlog και unfinished/outsourced jobs. Το comparison view δείχνει paired διαφορές και αβεβαιότητα, μαζί με scenario inputs και cost assumptions.

Η ανάλυση γίνεται ανά ζώνη, τύπο/δυνατότητα, τοπική ώρα/βάρδια, weekday/weekend και ημερολογιακό context, όταν το δείγμα το επιτρέπει. Μέσοι όροι και tail metrics διατηρούν τις αποτυχημένες/μη ολοκληρωμένες εργασίες στον σωστό παρονομαστή. Ένα aggregate coverage ποσοστό δεν αντικαθιστά την ανάλυση των χειρότερα εξυπηρετούμενων περιοχών.

Για καιρό, επίσημη πηγή είναι το [NOAA GHCNh](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly): station/quality/time provenance και bounded Austin subset. Οι observations κοντά στη δημοσίευση report δεν βαφτίζονται καιρός κατά τη βλάβη. Για calendar, το [OPM](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/) είναι μία federal πηγή και χρειάζεται jurisdiction/actual/observed διάκριση. Crowding, events και road closures παραμένουν candidate adapters μέχρι να επιλεγούν πηγές· δεν δημιουργούνται φανταστικά layers.

Για anomalies προτείνεται αρχικά εποχικό baseline και robust residual flag, με minimum support, zero-MAD fallback και χωριστό reporting-outage indicator. Το [NIST](https://itl.nist.gov/div898/handbook/eda/section3/eda35h.htm) παρέχει γενική στατιστική κατεύθυνση, όχι έτοιμο roadside detector. Δεν αναφέρουμε accuracy χωρίς κατάλληλα labels/αξιολόγηση.

## Validation πριν από επιχειρησιακό ισχυρισμό

Πρώτα engine invariants και χειροϋπολογισμένα traces: δύο ταυτόχρονες εργασίες/μία μονάδα, ασύμβατη ρυμούλκηση, shift boundary, βλάβη μονάδας και ουρά στο τέλος του horizon. Διατηρείται λογιστική arrivals = completed + active + queued + ρητά diverted/abandoned. Τα τμήματα road/onsite/return δεν συγχέονται.

Έπειτα empirical replay και σύγκριση με πραγματικά dispatch logs, όπου υπάρχουν. Η επιλογή μοντέλου ακολουθεί [rolling-origin evaluation](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation), με features διαθέσιμα τη στιγμή της απόφασης. Το ήδη εξετασμένο2025holdout δεν είναι νέο ανέγγιχτο test όταν καθοδηγεί retuning. Monte Carlo intervals περιγράφουν simulation variability, όχι όλη την αβεβαιότητα δεδομένων/παραμέτρων. Απαιτείται sensitivity σε load, duration, travel, resource loss και shift changes.

## Τι υλοποιήθηκε για το research RAG

Δημιουργήθηκε τοπικό retrieval index από πρωτότυπες σύντομες παραφράσεις, με26 records στο `sources.jsonl`. Κάθε record έχει URL, publisher, ημερομηνία ή null, πρόσβαση full/abstract, γεωγραφικό scope, locator, evidence, limitation και χωριστή proposed εφαρμογή. Hash αφορά το curated record· δεν παριστάνει checksum του remote PDF. Δεν αντιγράφηκαν ολόκληρα papers.

Το `retrieve.py` χρησιμοποιεί BM25-style lexical ranking και εμφανείς Greek→English aliases. Επιστρέφει τις πηγές μαζί με limitations, δέχεται φίλτρο study/direct-only και δεν καλεί μοντέλο ή δίκτυο. Το παρόν memo συνθέτει το ανακτημένο context με χειροκίνητη επιθεώρηση των πρωτογενών πηγών. Δεν αποτελεί deployed Bedrock KB ή semantic-embedding benchmark. Στο μελλοντικό προϊόν το RAG μπορεί να εξηγεί αποτέλεσμα και παραδοχές· ο optimizer/simulator υπολογίζει τα νούμερα. Το [AWS documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-retrieve-generate.html) τεκμηριώνει source references/metadata, χωρίς να εγγυάται ότι μια citation καθιστά αληθές ένα claim.

Αναπαραγωγή από αυτόν τον φάκελο:

```powershell
python retrieve.py --help
python retrieve.py --validate
python retrieve.py "Υπάρχουν πραγματικοί χρόνοι εξυπηρέτησης battery tyre στο Austin;" --top 5
python retrieve.py "Roadside discrete event simulation service duration" --kind study --direct-only
python verify_retrieval.py --help
python verify_retrieval.py
```

Το `verification.json` καταγράφει12ερωτήματα και12smoke checks: αναμενόμενες βασικές πηγές, άσχετο ερώτημα χωρίς evidence, φίλτρα, και σκόπιμη απόρριψη αλλοιωμένου hash/private ή shipped-status record. Δεν είναι claim retrieval accuracy ή validation στόλου. Το `retrieval-contexts.json` διατηρεί τα contexts της σύνθεσης.

Η έρευνα δεν εκκίνησε app implementation, cloud resource, paid API, video production ή δημοσίευση. Το υπάρχον budget δεν επιβαρύνθηκε με νέες AWS/LLM/routing κλήσεις από αυτά τα scripts. Επόμενο βήμα είναι η ενσωμάτωση των προτάσεων στο συμφωνημένο brief και η επιλογή πραγματικών operational logs ή ρητού assumption-based demo.
