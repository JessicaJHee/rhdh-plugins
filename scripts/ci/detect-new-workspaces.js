/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import fs from 'fs';
import path from 'path';
import { format as prettierFormat } from 'prettier';

const workspacesDir = path.resolve('workspaces');
const presetsDir = path.resolve('.github', 'renovate-presets', 'workspace');
const renovateJsonPath = path.resolve('.github', 'renovate.json');
const codeownersPath = path.resolve('.github', 'CODEOWNERS');

function listWorkspaceNames() {
  if (!fs.existsSync(workspacesDir)) return [];
  return fs
    .readdirSync(workspacesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .filter(name => name !== 'noop')
    .sort();
}

function isWorkspaceCovered(workspaceName) {
  if (!fs.existsSync(presetsDir)) return false;
  const presetFiles = fs
    .readdirSync(presetsDir)
    .filter(file => file.endsWith('.json'));
  const matcher = `workspaces/${workspaceName}/**`;
  for (const file of presetFiles) {
    try {
      const json = JSON.parse(
        fs.readFileSync(path.join(presetsDir, file), 'utf8'),
      );
      const rules = Array.isArray(json.packageRules) ? json.packageRules : [];
      for (const rule of rules) {
        const names = Array.isArray(rule.matchFileNames)
          ? rule.matchFileNames
          : [];
        if (names.includes(matcher)) return true;
      }
    } catch (error) {
      console.warn(`Skipping invalid preset JSON: ${file}`);
    }
  }
  return false;
}

function toTitleCase(source) {
  return source
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map(token => token.charAt(0).toLocaleUpperCase('en-US') + token.slice(1))
    .join(' ');
}

async function ensureRenovateExtends(presetRef) {
  const renovate = JSON.parse(fs.readFileSync(renovateJsonPath, 'utf8'));
  const packageRules = Array.isArray(renovate.packageRules)
    ? renovate.packageRules
    : [];
  const allWorkspacesRuleIndex = packageRules.findIndex(
    rule => rule.description === 'all RHDH Plugins workspaces',
  );
  if (allWorkspacesRuleIndex === -1) {
    throw new Error(
      'Could not find "all RHDH Plugins workspaces" rule in .github/renovate.json',
    );
  }
  const extendsArray = Array.isArray(
    packageRules[allWorkspacesRuleIndex].extends,
  )
    ? packageRules[allWorkspacesRuleIndex].extends
    : [];
  if (!extendsArray.includes(presetRef)) {
    extendsArray.push(presetRef);
    packageRules[allWorkspacesRuleIndex].extends = extendsArray;
    renovate.packageRules = packageRules;
    const formatted = await prettierFormat(JSON.stringify(renovate), {
      parser: 'json',
    });
    fs.writeFileSync(renovateJsonPath, formatted);
    return true;
  }
  return false;
}

if (!fs.existsSync(presetsDir)) fs.mkdirSync(presetsDir, { recursive: true });

function buildPresetJson(workspaceName) {
  const displayName = toTitleCase(workspaceName.replace(/^rhdh-/, ''));
  return {
    packageRules: [
      {
        description: `all ${displayName} minor updates`,
        matchFileNames: [`workspaces/${workspaceName}/**`],
        extends: [
          `github>redhat-developer/rhdh-plugins//.github/renovate-presets/base/rhdh-minor-presets(${displayName})`,
        ],
        addLabels: ['team/rhdh', `${workspaceName}`],
      },
      {
        description: `all ${displayName} patch updates`,
        matchFileNames: [`workspaces/${workspaceName}/**`],
        extends: [
          `github>redhat-developer/rhdh-plugins//.github/renovate-presets/base/rhdh-patch-presets(${displayName})`,
        ],
        addLabels: ['team/rhdh', `${workspaceName}`],
      },
      {
        description: `all ${displayName} dev dependency updates`,
        matchFileNames: [`workspaces/${workspaceName}/**`],
        extends: [
          `github>redhat-developer/rhdh-plugins//.github/renovate-presets/base/rhdh-devdependency-presets(${displayName})`,
        ],
        addLabels: ['team/rhdh', `${workspaceName}`],
      },
    ],
  };
}

function findUncoveredWorkspaces() {
  const all = listWorkspaceNames();
  const uncovered = [];
  for (const ws of all) {
    if (!isWorkspaceCovered(ws)) uncovered.push(ws);
  }
  return uncovered;
}

function parseCodeownersOwnersFor(workspaceName, codeownersContent) {
  const pattern = new RegExp(`^/workspaces/${workspaceName}\\s+(.+)$`);
  const lines = codeownersContent.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      const ownersPart = match[1];
      const tokens = ownersPart
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.startsWith('@'));
      return tokens;
    }
  }
  return [];
}

function aggregateReviewers(workspacesList, codeownersContent) {
  const individualSet = new Set();
  const teamSet = new Set();
  for (const ws of workspacesList) {
    const owners = parseCodeownersOwnersFor(ws, codeownersContent);
    for (const owner of owners) {
      const ownerName = owner.slice(1);
      if (ownerName.includes('/')) {
        teamSet.add(ownerName);
      } else {
        individualSet.add(ownerName);
      }
    }
  }
  return {
    reviewers: Array.from(individualSet).sort(),
    team_reviewers: Array.from(teamSet).sort(),
  };
}

const argv = process.argv.slice(2);
switch (argv[0]) {
  case '--apply': {
    const ws = argv[1];
    if (!ws) {
      console.error('ERROR: --apply requires a workspace name');
      process.exit(2);
    }
    if (isWorkspaceCovered(ws)) {
      const codeownersContent = fs.existsSync(codeownersPath)
        ? fs.readFileSync(codeownersPath, 'utf8')
        : '';
      const reviewers = aggregateReviewers([ws], codeownersContent);
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `workspace=\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `reviewers=\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `team_reviewers=\n`);
      }
      console.log(JSON.stringify({ workspace: ws, ...reviewers }));
      process.exit(0);
    }
    const presetFilePath = path.join(presetsDir, `rhdh-${ws}-presets.json`);
    const presetJson = buildPresetJson(ws);
    const formattedPreset = await prettierFormat(JSON.stringify(presetJson), {
      parser: 'json',
    });
    fs.writeFileSync(presetFilePath, formattedPreset, 'utf8');
    const presetRef = `github>redhat-developer/rhdh-plugins//.github/renovate-presets/workspace/rhdh-${ws}-presets`;
    await ensureRenovateExtends(presetRef);
    const codeownersContent = fs.existsSync(codeownersPath)
      ? fs.readFileSync(codeownersPath, 'utf8')
      : '';
    const reviewers = aggregateReviewers([ws], codeownersContent);
    if (process.env.GITHUB_OUTPUT) {
      const indivCsv = (reviewers.reviewers || []).join(',');
      const teamsCsv = (reviewers.team_reviewers || []).join(',');
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `workspace=${ws}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `reviewers=${indivCsv}\n`);
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `team_reviewers=${teamsCsv}\n`,
      );
    }
    console.log(JSON.stringify({ workspace: ws, ...reviewers }));
    break;
  }
  case '--list': {
    const queue = findUncoveredWorkspaces();
    console.log(JSON.stringify(queue));
    break;
  }
  default: {
    console.error(
      `Unknown command: ${argv[0]}. Use --list (default) or --apply <workspace>.`,
    );
    break;
  }
}
