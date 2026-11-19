// Cấu hình Drop-list dựng từ seedData – tương đương cfg_() của hệ cũ ngay sau setup() (OLD/apps-script/Core.gs).
import type { DropdownConfigBundle } from '../../shared/validation.ts';
import {
  INITIAL_DROPDOWN_LISTS,
  INITIAL_LOCATION_TO_SITES,
  INITIAL_REGION_TO_LOCATIONS,
  INITIAL_SUB_SOURCE_MAPPING,
} from '../../shared/seedData.ts';

export function seedConfig(extra: Record<string, string[]> = {}): DropdownConfigBundle {
  const lists: DropdownConfigBundle['lists'] = {};
  for (const l of INITIAL_DROPDOWN_LISTS) lists[l.listKey] = l.options.map((value) => ({ value, active: true }));
  for (const [k, vals] of Object.entries(extra)) {
    lists[k] = [...(lists[k] || []), ...vals.map((value) => ({ value, active: true }))];
  }
  return {
    lists,
    subSourceMapping: { ...INITIAL_SUB_SOURCE_MAPPING },
    regionToLocations: { ...INITIAL_REGION_TO_LOCATIONS },
    locationToSites: { ...INITIAL_LOCATION_TO_SITES },
  };
}
