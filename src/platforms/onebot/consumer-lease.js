import { acquireConsumerLease } from '../../management/operations/lease.js'

export async function acquireOneBotConsumerLease({ directory, logger = console }) {
  return acquireConsumerLease({
    directory,
    onCompromised: () => logger.error('消费者租约被其他进程接管，当前进程将停止接收和发送'),
  })
}
