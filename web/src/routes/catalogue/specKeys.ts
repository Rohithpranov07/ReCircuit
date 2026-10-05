import type { Category } from '../../api/types';

/** Allowed specification keys per category (TRD §4). The database checks them again (SPEC_KEY_UNKNOWN). */
export const SPEC_KEYS: Record<Category, string[]> = {
  DEVICE: ['form_factor', 'release_year', 'screen_in'],
  BATTERY: ['chemistry', 'capacity_mAh', 'nominal_V', 'cycle_rating'],
  STORAGE: ['interface', 'capacity_GB'],
  MEMORY: ['type', 'capacity_GB', 'speed_MTs'],
  DISPLAY: ['panel', 'size_in', 'resolution'],
  BOARD: ['board_rev'],
  CHIP: ['function', 'package'],
  OTHER: [],
};

export const NUMERIC_KEYS = new Set(['release_year', 'screen_in', 'capacity_mAh', 'nominal_V', 'cycle_rating', 'capacity_GB', 'speed_MTs', 'size_in']);
