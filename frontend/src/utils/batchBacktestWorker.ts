// Web Worker for batch backtest — runs runBatchSimulation off the main thread.
// Receives a WorkerInput message, posts back a BatchSimResult.

import { runBatchSimulation } from './batchBacktestSimulator';
import type { Candle } from '../types';
import type { AutoBacktestConfig } from './autoBacktestEngine';
import type { BatchSimResult } from './batchBacktestSimulator';

interface WorkerInput {
  candles: Candle[];
  config: AutoBacktestConfig;
  startIndex: number;
  instrument: string;
  tradeQuantity: number;
  sessionInterval?: string;
}

addEventListener('message', (e: MessageEvent<WorkerInput>) => {
  const { candles, config, startIndex, instrument, tradeQuantity, sessionInterval } = e.data;
  const result: BatchSimResult = runBatchSimulation(
    candles,
    config,
    startIndex,
    instrument,
    tradeQuantity,
    sessionInterval,
    (percent) => postMessage({ type: 'progress', percent })
  );
  postMessage({ type: 'complete', result });
});
