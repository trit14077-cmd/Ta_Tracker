import React from 'react';
import { currentStage, STAGE_CLASSES, STAGE_LABELS } from '../../../shared/stage.ts';

/** Small stage label shown right under a candidate's name. Derived from the R1 / R2 / Onboard statuses. */
export const StageBadge: React.FC<{ candidate: Record<string, unknown> }> = ({ candidate }) => {
  const stage = currentStage(candidate);
  return (
    <span
      className={`inline-block px-1.5 py-px rounded text-[10px] font-semibold leading-4 ${STAGE_CLASSES[stage]}`}
      title={`Stage: ${STAGE_LABELS[stage].en}`}
    >
      {STAGE_LABELS[stage].vi}
    </span>
  );
};
