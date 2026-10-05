import { createHash } from 'node:crypto'
import type { RecordedObservationPayload } from '../../shared/run-observation-recorded'
import { buildRunObservationArchive } from './archive'

export const recordedFixture = (): { payload: RecordedObservationPayload; bytes: Buffer } => {
  const bytes = Buffer.from(
    '<h1>Recorded project export</h1><script>throw Error("untrusted")</script>'
  )
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const log = (text = ''): { text: string; truncated: boolean; redacted: boolean } => ({
    text,
    truncated: false,
    redacted: false
  })
  const media = {
    mediaKey: 'export-a',
    name: 'project.html',
    mimeType: 'text/html',
    checksum,
    sizeBytes: bytes.length,
    sourceVersionId: 'author-version',
    stepKeys: ['observation-0']
  }
  return {
    bytes,
    payload: {
      receiving: {
        projectId: 'receiver-project',
        sessionId: 'receiver-session',
        artifactId: 'archive-artifact',
        versionId: 'archive-version'
      },
      archive: buildRunObservationArchive({
        recordingId: 'recording-a',
        capturedAt: 300,
        stopReason: 'run-ended',
        media: [media],
        history: {
          coverage: 'process-local',
          truncated: false,
          snapshots: [
            {
              identity: {
                projectId: 'author-project',
                sessionId: 'author-session',
                runId: 'author-run'
              },
              cursor: { epoch: 'author-epoch', sequence: 0 },
              observedAt: 200,
              phase: 'completed',
              stepId: 'run:author-run',
              artifactsTruncated: false,
              artifacts: [],
              run: {
                runId: 'author-run',
                kernelKind: 'bash',
                status: 'completed',
                startedAt: 100,
                endedAt: 190,
                exitCode: 0,
                logs: { stdout: log('Actual author output'), stderr: log(), traceback: log() }
              }
            }
          ]
        }
      }),
      media: [
        {
          mediaKey: media.mediaKey,
          artifactId: 'receiver-media',
          versionId: 'receiver-version',
          checksum,
          sizeBytes: bytes.length
        }
      ]
    }
  }
}
