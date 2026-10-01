import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../common/db/database.service';

export type PredictionKind = 'ETA_PICKUP' | 'ETA_TRIP' | 'DEMAND' | 'CANCELLATION' | 'MATCH_RANK' | 'FRAUD' | 'FARE' | 'NLU';

/** Records predictions and later attaches actual outcomes, which is the raw material for training and monitoring. */
@Injectable()
export class PredictionsService {
  constructor(private readonly db: DatabaseService) {}

  async log(
    p: {
      kind: PredictionKind;
      model: string;
      version: string;
      entityType?: string;
      entityId?: string;
      features?: unknown;
      prediction: unknown;
      predictedValue?: number | null;
      latencyMs?: number | null;
      fallback?: boolean;
    },
    client?: Queryable,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO ai_predictions (kind, model_name, model_version, entity_type, entity_id, features, prediction, predicted_value, latency_ms, fallback_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        p.kind,
        p.model,
        p.version,
        p.entityType ?? null,
        p.entityId ?? null,
        JSON.stringify(p.features ?? {}),
        JSON.stringify(p.prediction),
        p.predictedValue ?? null,
        p.latencyMs ?? null,
        p.fallback ?? false,
      ],
      client,
    );
  }

  /** Attach the observed value to the latest unresolved prediction of this kind for the entity. */
  async resolve(kind: PredictionKind, entityType: string, entityId: string, actual: number): Promise<void> {
    await this.db.query(
      `UPDATE ai_predictions SET actual_value = $4, abs_error = abs(predicted_value - $4), resolved_at = now()
        WHERE id = (SELECT id FROM ai_predictions WHERE kind = $1 AND entity_type = $2 AND entity_id = $3 AND resolved_at IS NULL
                    ORDER BY id DESC LIMIT 1)`,
      [kind, entityType, entityId, actual],
    );
  }
}
