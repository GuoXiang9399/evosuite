// Lookup table for empirical amino-acid substitution models.
// Each entry exposes the exchangeability matrix S and equilibrium frequencies PI
// (order: A R N D C Q E G H I L K M F P S T W Y V).

import { DAYHOFF_S, DAYHOFF_PI } from './dayhoff'
import { JTT_S, JTT_PI } from './jtt'
import { WAG_S, WAG_PI } from './wag'
import { LG_S, LG_PI } from './lg'

export interface AAMatrix {
  S: number[][]
  PI: number[]
}

export const AA_MATRICES: Record<string, AAMatrix> = {
  dayhoff: { S: DAYHOFF_S, PI: DAYHOFF_PI },
  jtt: { S: JTT_S, PI: JTT_PI },
  wag: { S: WAG_S, PI: WAG_PI },
  lg: { S: LG_S, PI: LG_PI },
}

export const AA_ORDER: string[] = ['A','R','N','D','C','Q','E','G','H','I','L','K','M','F','P','S','T','W','Y','V']
