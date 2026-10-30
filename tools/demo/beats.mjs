/** Source-only storyboard. Timing is fixed before capture; no metrics are invented. */
export const FPS = 30;
export const VIEWPORT = {width: 1440, height: 900};
export const BEATS = [
  {
    id: 'overview', seconds: 20,
    narration: 'Before a roadside-assistance shift starts, one question matters: where should the available vehicles wait? Standby turns historical stalled-vehicle reports into a placement comparison. These are real Austin reports, a hypothetical fleet, and modeled road approach times. The public simulator works without an account.',
    captions: [
      [0, 5, 'Before a shift starts: where should the available vehicles wait?'],
      [5, 10, 'Standby compares standby locations using historical Austin reports.'],
      [10, 15, 'Real reports. Hypothetical fleet. Modeled road approach times.'],
      [15, 20, 'The public simulator runs without an account.'],
    ],
  },
  {
    id: 'history', seconds: 25,
    narration: 'Start with the evidence. Each history row is an aggregated demand zone, rather than a customer or vehicle. Training reports select the planning model; later reports are held out for evaluation. Open a zone to inspect coverage and provenance. Publication time is explicitly distinguished from the time a breakdown happened.',
    captions: [
      [0, 6, 'Inspect the evidence behind each aggregated demand zone.'],
      [6, 12, 'Public views exclude report identifiers and exact incident addresses.'],
      [12, 19, 'Training selects the model. Later reports evaluate it.'],
      [19, 25, 'Report publication time is not breakdown time.'],
    ],
  },
  {
    id: 'baseline', seconds: 30,
    narration: 'Now compare the same fleet under the same assumptions. A single-depot baseline and a geographically spread baseline use the same Amazon Location road-time snapshot. Change the approach threshold and run a real calculation. Coverage is measured against historical demand, with unreachable routes and uncovered areas kept visible. No straight-line circle substitutes for a road route.',
    captions: [
      [0, 7, 'Compare the same fleet under the same assumptions.'],
      [7, 14, 'Depot and spread baselines use the same AWS road-time snapshot.'],
      [14, 22, 'Change the threshold and execute a real coverage calculation.'],
      [22, 30, 'Uncovered zones remain visible. Coverage polygons are not isochrones.'],
    ],
  },
  {
    id: 'proposal', seconds: 30,
    narration: 'Standby searches the bounded set of candidate positions using training demand only. The selected proposal is then assessed on the held-out year. Switch between placements and inspect both coverage gains and losses. The map exposes the actual zones behind the summary, so a manager can question an apparently stronger plan instead of relying on a single percentage.',
    captions: [
      [0, 7, 'Placement search uses training demand only.'],
      [7, 14, 'The selected proposal is assessed on held-out reports.'],
      [14, 22, 'Inspect coverage gains and losses, not only a summary percentage.'],
      [22, 30, 'Candidate sites and fleet availability remain scenario assumptions.'],
    ],
  },
  {
    id: 'unavailable', seconds: 25,
    narration: 'A plan also needs to survive a missing vehicle. Mark one unit unavailable, then calculate again. Standby updates the proposed placement, second-unit backup, and remaining coverage gaps. These are modeled road approach times, not customer waits or achieved service levels. Dispatch preparation, simultaneous jobs, and service duration are outside this first model.',
    captions: [
      [0, 6, 'Test the plan with one unit unavailable.'],
      [6, 13, 'Recalculate placement, backup coverage and remaining gaps.'],
      [13, 19, 'Road approach time is not customer waiting time or an achieved SLA.'],
      [19, 25, 'Dispatch preparation, simultaneous jobs and service duration are excluded.'],
    ],
  },
  {
    id: 'provenance', seconds: 15,
    narration: 'Inspect the source, cohort boundaries, hashes, provider and expiry. Amazon Location supplies the road times and compatible map. Standby supports a more informed standby decision, with assumptions and remaining gaps in view.',
    captions: [
      [0, 5, 'Inspect source provenance, cohort boundaries and snapshot hashes.'],
      [5, 10, 'Amazon Location provides road times and the compatible basemap.'],
      [10, 15, 'An informed standby decision, with assumptions and gaps in view.'],
    ],
  },
];

export function storyboard(releaseSha) {
  let offset = 0;
  const cues = [], transcript = [];
  for (const beat of BEATS) {
    transcript.push({id: beat.id, startSeconds: offset, endSeconds: offset + beat.seconds, narration: beat.narration});
    for (const [start, end, text] of beat.captions) cues.push({beatId: beat.id, startSeconds: offset + start, endSeconds: offset + end, text});
    offset += beat.seconds;
  }
  return {schemaVersion: 1, releaseSha, fps: FPS, viewport: VIEWPORT, durationSeconds: offset, beats: transcript, cues};
}
