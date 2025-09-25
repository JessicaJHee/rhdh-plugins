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

function listWorkspaceNames() {
  if (!fs.existsSync(workspacesDir)) return [];
  return fs
    .readdirSync(workspacesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
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

const workspaces = listWorkspaceNames();
const created = [];
for (const workspaceName of workspaces) {
  if (isWorkspaceCovered(workspaceName)) continue;
  const displayName = toTitleCase(workspaceName.replace(/^rhdh-/, ''));
  const presetFilePath = path.join(
    presetsDir,
    `rhdh-${workspaceName}-presets.json`,
  );
  const presetJson = {
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
  const formattedPreset = await prettierFormat(JSON.stringify(presetJson), {
    parser: 'json',
  });
  fs.writeFileSync(presetFilePath, formattedPreset, 'utf8');

  const presetRef = `github>redhat-developer/rhdh-plugins//.github/renovate-presets/workspace/rhdh-${workspaceName}-presets`;
  await ensureRenovateExtends(presetRef);
  created.push(workspaceName);
}

console.log(JSON.stringify({ created }));
