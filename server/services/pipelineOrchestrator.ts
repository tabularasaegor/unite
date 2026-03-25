/**
 * Pipeline Orchestrator — Master controller
 * Runs the full pipeline: Scan → Research → Probability → Risk → Execute → Monitor → Settle → Postmortem
 * 
 * FIXES:
 * - Re-checks date/sector filters before processing each opportunity
 * - Scheduler reads interval from config dynamically
 * - Wraps all stages in try/catch to prevent crashes
 */

import { log } from "../index";
import { storage } from "../storage";
import { runMarketScan, getLastScanResult, isScanRunning } from "./marketScanner";
import { researchOpportunity } from "./researchSwarm";
import { estimateProbability } from "./probabilityEngine";
import { assessRisk } from "./riskEngine";
import { executeOpportunity, updatePositionPrices, checkMarketResolutions } from "./executionEngine";
import { checkSettlements, generatePostMortem, recordPerformanceSnapshot } from "./settlementMonitor";

let pipelineInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let lastRunAt: string | null = null;

export interface PipelineStatus {
  running: boolean;
  schedulerActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  intervalMinutes: number;
  killSwitch: boolean;
  stats: {
    totalOpportunities: number;
    inResearch: number;
    analyzed: number;
    pendingApproval: number;
    activePositions: number;
    settled: number;
  };
}

// --- Check if opportunity is a daily crypto event (above/up-or-down) ---
function isDailyCryptoEvent(opp: any): boolean {
  const title = (opp.title || "").toLowerCase();
  const slug = (opp.slug || "").toLowerCase();
  return (
    (slug.includes("-above-on-") || slug.includes("-up-or-down-on-")) &&
    (title.includes("bitcoin") || title.includes("ethereum") || title.includes("solana") || title.includes("xrp"))
  );
}

// --- Date filter check for individual opportunity ---
function isOpportunityWithinDateRange(opp: any): boolean {
  const minDays = parseInt(storage.getConfig("pipeline_min_days") || "0");
  const maxDays = parseInt(storage.getConfig("pipeline_max_days") || "365");
  
  if (!opp.endDate) return true; // No date = allow
  
  try {
    const end = new Date(opp.endDate);
    const days = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (days < 0) return false; // Expired
    // Daily crypto events (above/up-or-down) allow same-day (days=0)
    const effectiveMinDays = isDailyCryptoEvent(opp) ? 0 : minDays;
    if (days < effectiveMinDays || days > maxDays) return false;
  } catch {
    return true; // Invalid date = allow
  }
  return true;
}

// --- Sector filter check ---
function isOpportunityInEnabledSector(opp: any): boolean {
  const enabledSectors = (storage.getConfig("pipeline_sectors") || "sports,crypto,politics,tech,other")
    .split(",").map(s => s.trim().toLowerCase());
  return enabledSectors.includes((opp.category || "other").toLowerCase());
}

// --- Run Full Pipeline ---

export async function runFullPipeline(): Promise<{
  scanned: number; researched: number; estimated: number;
  riskAssessed: number; executed: number; settled: number;
  postMortems: number; errors: string[];
}> {
  if (isRunning) {
    return { scanned: 0, researched: 0, estimated: 0, riskAssessed: 0, executed: 0, settled: 0, postMortems: 0, errors: ["Pipeline already running"] };
  }

  isRunning = true;
  const errors: string[] = [];
  let scanned = 0, researched = 0, estimated = 0, riskAssessed = 0, executed = 0, settled = 0, postMortems = 0;

  const maxOppsPerRun = parseInt(storage.getConfig("pipeline_max_per_run") || "10");
  const minEdgeThreshold = parseFloat(storage.getConfig("min_edge_threshold") || "0.015");
  const killSwitchActive = storage.getConfig("kill_switch") === "true";

  try {
    log("═══ Starting full pipeline run ═══", "pipeline");

    if (killSwitchActive) {
      log("Kill switch is active — skipping execution stage", "pipeline");
    }

    // Stage 1: Scan markets
    try {
      const scanResult = await runMarketScan();
      scanned = scanResult.totalDiscovered;
      log(`Stage 1 (Scan): ${scanned} new opportunities`, "pipeline");
    } catch (err) {
      errors.push(`Scan: ${err}`);
    }

    // Stage 2: Research — RE-CHECK date/sector filters before processing
    const toResearch = storage.getOpportunities({ stage: "scan", limit: maxOppsPerRun * 3 })
      .filter(o => isOpportunityWithinDateRange(o) && isOpportunityInEnabledSector(o))
      .slice(0, maxOppsPerRun);
    
    // Reject opportunities outside date range
    const allScanOpps = storage.getOpportunities({ stage: "scan", limit: 1000 });
    for (const opp of allScanOpps) {
      if (!isOpportunityWithinDateRange(opp) || !isOpportunityInEnabledSector(opp)) {
        storage.updateOpportunity(opp.id, { status: "rejected", pipelineStage: "risk" });
      }
    }

    for (const opp of toResearch) {
      try {
        await researchOpportunity(opp.id);
        researched++;
      } catch (err) {
        errors.push(`Research ${opp.id}: ${err}`);
      }
    }
    log(`Stage 2 (Research): ${researched} opportunities researched`, "pipeline");

    // Stage 3: Probability estimation
    const toEstimate = storage.getOpportunities({ stage: "research", limit: maxOppsPerRun })
      .filter(o => isOpportunityWithinDateRange(o));
    for (const opp of toEstimate) {
      try {
        await estimateProbability(opp.id);
        estimated++;
      } catch (err) {
        errors.push(`Probability ${opp.id}: ${err}`);
      }
    }
    log(`Stage 3 (Probability): ${estimated} estimates generated`, "pipeline");

    // Stage 4: Risk assessment
    const toRisk = storage.getOpportunities({ stage: "probability", limit: maxOppsPerRun })
      .filter(o => isOpportunityWithinDateRange(o));
    for (const opp of toRisk) {
      try {
        if (Math.abs(opp.edge || 0) >= minEdgeThreshold) {
          await assessRisk(opp.id);
          riskAssessed++;
        } else {
          storage.updateOpportunity(opp.id, { status: "rejected", pipelineStage: "risk" });
        }
      } catch (err) {
        errors.push(`Risk ${opp.id}: ${err}`);
      }
    }
    log(`Stage 4 (Risk): ${riskAssessed} assessments created`, "pipeline");

    // Stage 5: Execute
    const autoExecuteEnabled = storage.getConfig("auto_execute") === "true";
    if (autoExecuteEnabled && !killSwitchActive) {
      const toExecute = storage.getOpportunities({ status: "approved" })
        .filter(o => o.pipelineStage === "risk" && isOpportunityWithinDateRange(o));
      for (const opp of toExecute) {
        try {
          await executeOpportunity(opp.id);
          executed++;
        } catch (err) {
          errors.push(`Execute ${opp.id}: ${err}`);
        }
      }
      log(`Stage 5 (Execute): ${executed} trades executed`, "pipeline");
    } else if (killSwitchActive) {
      log("Stage 5 (Execute): SKIPPED — kill switch active", "pipeline");
    } else {
      log("Stage 5 (Execute): SKIPPED — auto_execute is off", "pipeline");
    }

    // Stage 6: Update position prices
    try {
      const priceResult = await updatePositionPrices();
      log(`Stage 6 (Prices): ${priceResult.updated} updated, ${priceResult.errors} errors`, "pipeline");
    } catch (err) {
      errors.push(`Position update: ${err}`);
    }

    // Stage 6b: Check resolutions
    try {
      const resResult = await checkMarketResolutions();
      if (resResult.resolved > 0) {
        log(`Stage 6b (Resolution check): ${resResult.resolved} markets appear resolved`, "pipeline");
      }
    } catch (err) {
      errors.push(`Resolution check: ${err}`);
    }

    // Stage 7: Settlements
    try {
      const settlementResult = checkSettlements();
      settled = settlementResult.settled;
      log(`Stage 7 (Settlement): ${settled} resolved`, "pipeline");
    } catch (err) {
      errors.push(`Settlement: ${err}`);
    }

    // Stage 8: Post-mortems
    const toPostMortem = storage.getOpportunities({ stage: "settlement" });
    for (const opp of toPostMortem) {
      try {
        await generatePostMortem(opp.id);
        postMortems++;
      } catch (err) {
        errors.push(`Post-mortem ${opp.id}: ${err}`);
      }
    }
    log(`Stage 8 (Post-mortem): ${postMortems} analyses generated`, "pipeline");

    recordPerformanceSnapshot();
    lastRunAt = new Date().toISOString();
    log(`═══ Pipeline complete: scanned=${scanned} researched=${researched} estimated=${estimated} risk=${riskAssessed} executed=${executed} settled=${settled} postmortems=${postMortems} ═══`, "pipeline");

  } catch (err) {
    errors.push(`Pipeline crash: ${err}`);
    log(`Pipeline crash: ${err}`, "pipeline");
  } finally {
    isRunning = false;
  }

  return { scanned, researched, estimated, riskAssessed, executed, settled, postMortems, errors };
}

// --- Run Single Stage ---

export async function runStage(stage: string, opportunityId?: number): Promise<any> {
  switch (stage) {
    case "scan":
      return await runMarketScan();
    case "research":
      if (!opportunityId) throw new Error("opportunityId required for research");
      return await researchOpportunity(opportunityId);
    case "probability":
      if (!opportunityId) throw new Error("opportunityId required for probability");
      return await estimateProbability(opportunityId);
    case "risk":
      if (!opportunityId) throw new Error("opportunityId required for risk");
      return await assessRisk(opportunityId);
    case "execute":
      if (!opportunityId) throw new Error("opportunityId required for execution");
      if (storage.getConfig("kill_switch") === "true") throw new Error("Kill switch active");
      return await executeOpportunity(opportunityId);
    case "settle":
      return checkSettlements();
    case "postmortem":
      if (!opportunityId) throw new Error("opportunityId required for postmortem");
      return await generatePostMortem(opportunityId);
    default:
      throw new Error(`Unknown stage: ${stage}`);
  }
}

// --- Scheduler ---

export function startPipelineScheduler(intervalMinutes?: number): void {
  if (pipelineInterval) clearInterval(pipelineInterval);

  // Read interval from config if not provided
  const interval = intervalMinutes || parseInt(storage.getConfig("pipeline_interval") || "30");
  storage.setConfig("pipeline_interval", String(interval));

  log(`Starting pipeline scheduler (every ${interval} min)`, "pipeline");

  // Run after brief delay
  setTimeout(() => runFullPipeline().catch(err => log(`Scheduled pipeline error: ${err}`, "pipeline")), 5000);

  pipelineInterval = setInterval(
    () => runFullPipeline().catch(err => log(`Scheduled pipeline error: ${err}`, "pipeline")),
    interval * 60 * 1000,
  );
}

export function stopPipelineScheduler(): void {
  if (pipelineInterval) {
    clearInterval(pipelineInterval);
    pipelineInterval = null;
    log("Pipeline scheduler stopped", "pipeline");
  }
}

// --- Status ---

export function getPipelineStatus(): PipelineStatus {
  const allOpps = storage.getOpportunities({});
  // Exclude micro [5m] from counts
  const regularOpps = allOpps.filter(o => !o.title?.startsWith("[5m]"));
  const intervalMinutes = parseInt(storage.getConfig("pipeline_interval") || "30");

  return {
    running: isRunning,
    schedulerActive: pipelineInterval !== null,
    lastRunAt,
    nextRunAt: pipelineInterval ? new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString() : null,
    intervalMinutes,
    killSwitch: storage.getConfig("kill_switch") === "true",
    stats: {
      totalOpportunities: regularOpps.length,
      inResearch: regularOpps.filter(o => o.pipelineStage === "research").length,
      analyzed: regularOpps.filter(o => o.status === "analyzed").length,
      pendingApproval: regularOpps.filter(o => o.status === "analyzed" && o.pipelineStage === "risk").length,
      activePositions: storage.getActivePositions("open").filter(p => !p.title?.startsWith("[5m]")).length,
      settled: regularOpps.filter(o => o.status === "settled").length,
    },
  };
}
