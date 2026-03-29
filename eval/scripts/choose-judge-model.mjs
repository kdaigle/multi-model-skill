#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { getModelFamily, loadModelsConfig } from './lib.mjs';

const { values } = parseArgs({
  options: {
    'start-model': { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help) {
  console.log(JSON.stringify({ usage: 'node eval/scripts/choose-judge-model.mjs [--start-model <id>]' }, null, 2));
  process.exit(0);
}

const modelsConfig = await loadModelsConfig();
const startModel = values['start-model'] ?? modelsConfig.implementationStartModel.id;
const override = process.env.EVAL_JUDGE_MODEL?.trim();
const startFamily = getModelFamily(modelsConfig, startModel);

const candidates = override
  ? [override]
  : modelsConfig.judgeCandidates;

const judgeModel = candidates.find((candidate) => getModelFamily(modelsConfig, candidate) !== startFamily)
  ?? candidates[0]
  ?? startModel;

const result = {
  startModel,
  judgeModel,
  startFamily,
  judgeFamily: getModelFamily(modelsConfig, judgeModel),
  source: override ? 'env-override' : 'config',
  differentFamily: getModelFamily(modelsConfig, judgeModel) !== startFamily
};

console.log(JSON.stringify(result, null, 2));
