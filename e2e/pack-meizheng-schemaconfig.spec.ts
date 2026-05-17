import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';

/**
 * Meizheng Pack — SchemaConfig render smoke.
 *
 * Locks in two behaviours that silently regressed during the
 * Phase 3b migration and were painful to debug:
 *
 *   1. System config view (`config_file:` absent, legacy IPC):
 *      UPS carrier card renders **both** service mappings from
 *      `fuel-rate-config.yaml`. A bug in `mergeDefaultsIntoData`
 *      or in the array renderer that drops the second entry
 *      would have shipped silently otherwise.
 *
 *   2. Zone config view (`config_file: zone-config`, named IPC):
 *      Declared `default:` carriers (`fedex`) appear in the UI
 *      even when the on-disk YAML only has `ups` + `usps`. This
 *      is the regression the user hit on 2026-05-17 right after
 *      the umbrella `MeizhengConfig.tsx` was deleted.
 *
 * Strategy: override `pack_views_list` + `pack_config_get` +
 * `pack_named_config_get` to feed deterministic fixtures, then
 * navigate to `/pack/meizheng/<viewId>` and assert visible
 * carrier / service cards. We DO NOT validate field labels char
 * by char — only that the right number of cards render, since
 * label changes are intentional and shouldn't break this spec.
 */

interface PackViewFixture {
  packId: string;
  packTitle: string;
  viewId: string;
  title: string;
  icon: string;
  navSection: string;
  template: string;
  dataSource: unknown;
  options: unknown;
  actions: never[];
}

function makeView(overrides: Partial<PackViewFixture>): PackViewFixture {
  return {
    packId: 'meizheng',
    packTitle: '美正',
    viewId: 'config',
    title: '系统配置',
    icon: 'Settings',
    navSection: 'settings',
    template: 'SchemaConfig',
    dataSource: {},
    options: {},
    actions: [],
    ...overrides,
  };
}

/**
 * Minimal carrier sub-schema reused by both views. Mirrors the
 * fields the real manifest declares — just enough to trigger the
 * record / array render paths under test.
 */
const CARRIER_INNER_SCHEMA = [
  { key: 'name', type: 'text', label: '名称' },
  { key: 'enabled', type: 'bool', label: '启用' },
  {
    key: 'services',
    type: 'array',
    label: '服务映射',
    show_if: 'enabled',
    item: [
      { key: 'sourceName', type: 'text', label: '源服务名' },
      { key: 'country', type: 'text', label: '国家' },
      {
        key: 'applyTo',
        type: 'select',
        label: '写入到',
        options: ['default', 'channels'],
      },
      {
        key: 'serviceCodes',
        type: 'tag',
        label: '服务代码',
        show_if: "applyTo == 'channels'",
      },
    ],
  },
];

const SYSTEM_CONFIG_VIEW = makeView({
  viewId: 'config',
  title: '系统配置',
  template: 'SchemaConfig',
  options: {
    schema: [
      {
        key: 'carriers',
        type: 'record',
        label: '承运商',
        key_label: '承运商 ID',
        fields: CARRIER_INNER_SCHEMA,
      },
    ],
  },
});

const ZONE_CONFIG_VIEW = makeView({
  viewId: 'zone-config',
  title: '分区配置',
  template: 'SchemaConfig',
  options: {
    config_file: 'zone-config',
    schema: [
      {
        key: 'carriers',
        type: 'record',
        label: '承运商',
        key_label: '承运商 ID',
        // Manifest-declared default: fedex appears even if disk YAML
        // omits it. Mirrors the real manifest's recovery for
        // `buildDefaultZoneConfig()`'s removed fallback.
        default: {
          fedex: {
            enabled: true,
            upload_prefix: 'FedEx Ground',
            source: { carrier: 'FedEx', service: 'Ground', totalZip3: 1000 },
            upload: { maxRetries: 3, retryDelay: 2, requestInterval: 1 },
          },
        },
        fields: [
          { key: 'enabled', type: 'bool', label: '启用' },
          { key: 'upload_prefix', type: 'text', label: '上传前缀' },
        ],
      },
    ],
  },
});

/**
 * Install the IPC overrides on `window.__CADUCEUS_MOCK__`. Returns
 * a script string ready for `page.addInitScript`.
 */
function installMocks(viewsJson: string, configJson: string, namedConfigJson: string) {
  return `
(function () {
  function tryInstall() {
    var mock = window.__CADUCEUS_MOCK__;
    if (!mock) { return setTimeout(tryInstall, 10); }
    mock.on('pack_views_list', function () { return ${viewsJson}; });
    mock.on('pack_config_get', function () { return ${configJson}; });
    mock.on('pack_named_config_get', function () { return ${namedConfigJson}; });
    mock.on('pack_config_set', function () { return null; });
    mock.on('pack_named_config_set', function () { return null; });
  }
  tryInstall();
})();
`;
}

async function gotoPackView(
  page: Page,
  viewId: string,
  views: PackViewFixture[],
  legacyConfig: unknown,
  namedConfig: unknown,
): Promise<void> {
  await page.addInitScript({
    content: installMocks(
      JSON.stringify(views),
      JSON.stringify(legacyConfig),
      JSON.stringify(namedConfig),
    ),
  });
  await page.goto(`/pack/meizheng/${viewId}`);
}

test.describe('meizheng SchemaConfig render', () => {
  test('system config: UPS carrier shows both service mappings from fuel-rate-config', async ({
    page,
  }) => {
    const ups = {
      name: 'UPS',
      enabled: true,
      services: [
        {
          sourceName: 'Domestic Ground Surcharge',
          country: 'US',
          applyTo: 'default',
        },
        {
          sourceName: 'Domestic Air Surcharge',
          country: 'US',
          applyTo: 'channels',
          serviceCodes: ['NEXT_DAY_AIR', 'SECOND_DAY_AIR'],
        },
      ],
    };

    await gotoPackView(
      page,
      'config',
      [SYSTEM_CONFIG_VIEW],
      { carriers: { ups } },
      {},
    );

    // The view title only renders after `pack_views_list` resolves +
    // `pack_config_get` returns. The lowercase `ups` is the record
    // entry key (rendered as a heading), not the `name: 'UPS'` field
    // value (which lives inside an <input> and isn't matched by
    // getByText).
    await expect(page.getByText('ups', { exact: true })).toBeVisible();

    // Two `applyTo` Select widgets = two service mapping cards. We
    // probe by label rather than card-class because Tailwind class
    // names are noise the spec shouldn't depend on.
    const writeToLabels = page.getByText('写入到', { exact: true });
    await expect(writeToLabels).toHaveCount(2);

    // serviceCodes only shows for the second service (applyTo=channels).
    const codesLabels = page.getByText('服务代码', { exact: true });
    await expect(codesLabels).toHaveCount(1);
  });

  test('zone config: manifest default-merge surfaces fedex even when YAML omits it', async ({
    page,
  }) => {
    // Disk has only ups + usps. fedex MUST appear from manifest defaults.
    await gotoPackView(
      page,
      'zone-config',
      [ZONE_CONFIG_VIEW],
      {},
      {
        carriers: {
          ups: { enabled: true, upload_prefix: 'UPS-GROUND' },
          usps: { enabled: true, upload_prefix: 'USPS-GROUND' },
        },
      },
    );

    await expect(page.getByText('ups', { exact: true })).toBeVisible();
    await expect(page.getByText('usps', { exact: true })).toBeVisible();
    // The regression we're guarding: fedex would be missing if
    // mergeDefaultsIntoData stopped seeding record defaults.
    await expect(page.getByText('fedex', { exact: true })).toBeVisible();
  });
});
