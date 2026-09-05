export const LOCATION_DEPTH_MAX = 8
export const ROLES = ['admin', 'user'] as const
export type Role = (typeof ROLES)[number]
