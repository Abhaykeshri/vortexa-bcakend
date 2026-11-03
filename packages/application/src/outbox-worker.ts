export interface OutboxMessage {
  readonly id: string;
  readonly topic: string;
  readonly payload: unknown;
  readonly attempts: number;
}

export interface DurableOutboxPort {
  claimOutbox(owner: string, limit: number): Promise<readonly OutboxMessage[]>;
  completeOutbox(id: string): Promise<void>;
  failOutbox(id: string, error: string, maxAttempts: number, delaySeconds: number): Promise<void>;
}

export interface NotificationPort {
  publish(topic: string, payload: unknown): Promise<void>;
}

export class OutboxWorker {
  constructor(
    private readonly outbox: DurableOutboxPort,
    private readonly notifications: NotificationPort,
    private readonly maxAttempts = 8,
  ) {}

  async runOnce(owner: string, limit = 25): Promise<{ processed: number; failed: number }> {
    const messages = await this.outbox.claimOutbox(owner, limit);
    let processed = 0;
    let failed = 0;
    for (const message of messages) {
      try {
        await this.notifications.publish(message.topic, message.payload);
        await this.outbox.completeOutbox(message.id);
        processed++;
      } catch (error) {
        const delay = Math.min(2 ** Math.min(message.attempts + 1, 10), 3600);
        await this.outbox.failOutbox(
          message.id,
          error instanceof Error ? error.message : 'notification failure',
          this.maxAttempts,
          delay,
        );
        failed++;
      }
    }
    return { processed, failed };
  }
}
