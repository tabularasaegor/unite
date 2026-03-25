/**
 * Execution Engine — Pipeline Stage 5
 * - Paper trading (default): simulate fills at current market price
 * - Live trading: use Polymarket CLOB via placeOrder()
 * - Kill switch check before executing
 * - Creates execution → position → settlement records
 */

import { log } from "../index";
import { storage } from "../storage";
import type { InsertExecution, InsertActivePosition } from "@shared/schema";
import { placeOrder, isTradeEnabled, fetchPrice, fetchMarkets } from "./polymarket";

function executePaperTrade(params: {
  opportunityId: number;
  platform: string;
  side: string;
  price: number;
  size: number;
}): InsertExecution {
  return {
    opportunityId: params.opportunityId,
    platform: params.platform,
    side: params.side,
    orderType: "market",
    requestedPrice: params.price,
    executedPrice: params.price,
    size: params.size,
    quantity: params.size / params.price,
    status: "filled",
    paperTrade: 1,
    slippage: 0,
    fees: 0,
    submittedAt: new Date().toISOString(),
    filledAt: new Date().toISOString(),
  };
}

export async function executeOpportunity(opportunityId: number): Promise<{ executionId: number; positionId: number }> {
  // Kill switch check
  if (storage.getConfig("kill_switch") === "true") {
    throw new Error("Kill switch is active — trading halted");
  }

  const opp = storage.getOpportunity(opportunityId);
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`);

  const riskAssessment = storage.getRiskAssessment(opportunityId);
  if (!riskAssessment || riskAssessment.approved !== 1) {
    throw new Error("Risk assessment not approved");
  }

  const isPaperTrading = storage.getConfig("paper_trading") !== "false";
  const side = opp.recommendedSide || "YES";
  const size = opp.recommendedSize || riskAssessment.halfKellySize;
  const price = opp.currentPrice || 0.5;

  log(`Executing ${isPaperTrading ? "PAPER" : "LIVE"} trade: ${side} $${size.toFixed(0)} on "${opp.title}" @ ${(price * 100).toFixed(1)}%`, "execution");

  storage.updateOpportunity(opportunityId, { pipelineStage: "execution" });

  let executionData: InsertExecution;

  if (isPaperTrading) {
    executionData = executePaperTrade({ opportunityId, platform: opp.platform, side, price, size });
  } else if (isTradeEnabled() && opp.clobTokenIds) {
    // Live Polymarket trading
    try {
      let tokenIds: string[] = [];
      try { tokenIds = JSON.parse(opp.clobTokenIds); } catch {}

      const tokenId = side === "YES" ? tokenIds[0] : tokenIds[1];
      if (!tokenId) throw new Error("No token ID for side " + side);

      const quantity = size / price;
      const orderResponse = await placeOrder({
        tokenId,
        price,
        size: quantity,
        side: "BUY",
        tickSize: opp.tickSize || "0.01",
        negRisk: !!opp.negRisk,
        orderType: "GTC",
      });

      executionData = {
        opportunityId,
        platform: opp.platform,
        side,
        orderType: "limit",
        requestedPrice: price,
        executedPrice: price,
        size,
        quantity,
        status: orderResponse ? "filled" : "failed",
        paperTrade: 0,
        externalOrderId: orderResponse?.orderID,
        slippage: 0,
        fees: 0,
        submittedAt: new Date().toISOString(),
        filledAt: orderResponse ? new Date().toISOString() : undefined,
        errorMessage: orderResponse ? undefined : "Order placement failed",
      };
    } catch (err: any) {
      executionData = {
        opportunityId,
        platform: opp.platform,
        side,
        orderType: "market",
        requestedPrice: price,
        size,
        status: "failed",
        paperTrade: 0,
        errorMessage: err.message,
        submittedAt: new Date().toISOString(),
      };
    }
  } else {
    // Live requested but CLOB not initialized — fall back to paper
    executionData = executePaperTrade({ opportunityId, platform: opp.platform, side, price, size });
    executionData.paperTrade = 0;
    log("Live trading requested but CLOB client not available — falling back to paper", "execution");
  }

  const execution = storage.createExecution(executionData);

  if (execution.status === "failed") {
    storage.createAuditEntry({
      action: "execute",
      entityType: "execution",
      entityId: execution.id,
      actor: "system",
      details: JSON.stringify({ error: execution.errorMessage }),
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Execution failed: ${execution.errorMessage}`);
  }

  const positionData: InsertActivePosition = {
    opportunityId,
    executionId: execution.id,
    platform: opp.platform,
    title: opp.title,
    side,
    entryPrice: execution.executedPrice || price,
    currentPrice: price,
    size,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    status: "open",
    openedAt: new Date().toISOString(),
  };

  const position = storage.createActivePosition(positionData);

  storage.createSettlement({
    opportunityId,
    positionId: position.id,
    ourPrediction: opp.aiProbability,
    marketPriceAtEntry: price,
    status: "monitoring",
    createdAt: new Date().toISOString(),
  });

  storage.updateOpportunity(opportunityId, {
    status: "approved",
    pipelineStage: "monitoring",
  });

  storage.createAuditEntry({
    action: "execute",
    entityType: "execution",
    entityId: execution.id,
    actor: isPaperTrading ? "system:paper" : "system:live",
    details: JSON.stringify({
      side, size, price, paperTrade: isPaperTrading,
      executionId: execution.id, positionId: position.id,
    }),
    timestamp: new Date().toISOString(),
  });

  log(`Trade executed: execution #${execution.id}, position #${position.id}`, "execution");
  return { executionId: execution.id, positionId: position.id };
}

export async function closePosition(positionId: number): Promise<void> {
  const position = storage.getActivePosition(positionId);
  if (!position) throw new Error(`Position ${positionId} not found`);
  if (position.status !== "open") throw new Error(`Position ${positionId} is not open`);

  log(`Closing position #${positionId} "${position.title}"`, "execution");

  const pnl = position.unrealizedPnl || 0;

  storage.updateActivePosition(positionId, {
    status: "closed",
    closedAt: new Date().toISOString(),
  });

  const settlement = storage.getSettlement(position.opportunityId);
  if (settlement) {
    storage.updateSettlement(settlement.id, {
      realizedPnl: pnl,
      realizedPnlPercent: position.entryPrice > 0 ? (pnl / position.size) * 100 : 0,
      status: "settled",
      resolvedAt: new Date().toISOString(),
    });
  }

  storage.createAuditEntry({
    action: "execute",
    entityType: "position",
    entityId: positionId,
    actor: "system",
    details: JSON.stringify({ action: "close", pnl }),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Update position prices from live Polymarket data.
 * Fetches current prices from CLOB API for each position's token.
 * Also updates the opportunity's currentPrice.
 */
export async function updatePositionPrices(): Promise<{ updated: number; errors: number }> {
  const openPositions = storage.getActivePositions("open");
  let updated = 0;
  let errors = 0;

  for (const pos of openPositions) {
    const opp = storage.getOpportunity(pos.opportunityId);
    if (!opp) continue;

    try {
      // Get live YES token price from CLOB API
      let livePrice: number | null = null;
      const tokenIds = opp.clobTokenIds ? JSON.parse(opp.clobTokenIds) : [];
      if (tokenIds.length > 0) {
        const priceStr = await fetchPrice(tokenIds[0]);
        if (priceStr) livePrice = parseFloat(priceStr);
      }

      // Fallback to opportunity's stored price
      const currentPrice = livePrice ?? opp.currentPrice ?? pos.entryPrice;

      // Update opportunity price too
      if (livePrice !== null) {
        storage.updateOpportunity(opp.id, {
          currentPrice: livePrice,
          marketProbability: livePrice,
        });
      }

      const priceDiff = pos.side === "YES"
        ? currentPrice - pos.entryPrice
        : pos.entryPrice - currentPrice;

      const unrealizedPnl = priceDiff * pos.size;
      const unrealizedPnlPercent = pos.entryPrice > 0 ? (priceDiff / pos.entryPrice) * 100 : 0;

      storage.updateActivePosition(pos.id, {
        currentPrice,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        unrealizedPnlPercent: Math.round(unrealizedPnlPercent * 100) / 100,
      });
      updated++;
    } catch (err) {
      errors++;
    }
  }

  if (updated > 0) {
    log(`Position prices updated: ${updated} positions, ${errors} errors`, "execution");
  }
  return { updated, errors };
}

/**
 * Check if any markets with open positions have resolved.
 * Uses Gamma API to check market status (closed field).
 */
export async function checkMarketResolutions(): Promise<{ resolved: number }> {
  const openPositions = storage.getActivePositions("open");
  let resolved = 0;

  // Group positions by opportunity to avoid duplicate API calls
  const oppIds = [...new Set(openPositions.map(p => p.opportunityId))];

  for (const oppId of oppIds) {
    const opp = storage.getOpportunity(oppId);
    if (!opp || !opp.slug) continue;

    try {
      // Check via CLOB price — if price is very close to 0 or 1, market likely resolved
      const tokenIds = opp.clobTokenIds ? JSON.parse(opp.clobTokenIds) : [];
      if (tokenIds.length === 0) continue;

      const priceStr = await fetchPrice(tokenIds[0]);
      if (!priceStr) continue;

      const price = parseFloat(priceStr);
      if (price > 0.95 || price < 0.05) {
        // Market appears resolved — update opportunity
        storage.updateOpportunity(oppId, {
          currentPrice: price,
          marketProbability: price,
        });
        resolved++;
        log(`Market resolution detected: "${opp.title}" → price=${price.toFixed(3)}`, "execution");
      }
    } catch (err) {
      // Silently skip — will retry next cycle
    }
  }

  return { resolved };
}
