import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  buildGenerationRequest,
  DOCUMENTATION_PROMPT,
  GenerationClientError,
  type FrozenProtocolConfig,
  type GenerationClient,
} from '../../../generation/index.ts';
import {
  buildRepresentationBundle,
  FunctionNotAdmittedError,
  type RepresentationId,
} from '../../../representations/index.ts';
import { readJson, sendJson } from '../http.ts';

const REPRESENTATIONS: readonly RepresentationId[] = ['b0', 'b1', 'b2', 'p'];

/** Provider handle resolved lazily, so a missing key only fails the probe. */
export interface ProviderHandle {
  client: GenerationClient;
  model: string;
}

/**
 * Builds the probe protocol: the same decoding settings as the frozen run, but
 * marked as a UI probe so its output is never mistaken for experimental data.
 *
 * @param model - Model identifier frozen for the probe.
 * @returns A frozen-shaped protocol used only to assemble one request.
 */
function probeProtocol(model: string): FrozenProtocolConfig {
  return {
    protocolVersion: '1.0-ui-probe',
    status: 'frozen',
    prompt: DOCUMENTATION_PROMPT,
    generation: {
      clientMode: 'provider',
      allowRealApi: true,
      provider: 'commandcode',
      model,
      modelVersion: 'ui-probe',
      temperature: 0,
      topP: 'provider-default',
      maxTokens: 128,
      seed: null,
      reasoningEffort: 'off',
    },
    retry: { maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2 },
  };
}

/**
 * Sends one representation of a pasted function to the configured model.
 *
 * This is the interactive counterpart of the experiment: it shows the exact
 * input the model receives and the exact text it returns. It writes nothing to
 * the experiment cache and does not count as evidence.
 *
 * @param createProvider - Resolves the client and model, or throws when the
 *   environment is incomplete.
 * @returns An HTTP handler for `POST /api/generate`.
 */
export function createGenerateRoute(createProvider: () => ProviderHandle) {
  return async function handleGenerateRoute(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || !('source' in parsed)) {
      sendJson(response, 400, { error: 'Envía el código fuente en el campo "source".' });
      return;
    }

    const source = parsed.source;
    if (typeof source !== 'string' || source.trim().length === 0) {
      sendJson(response, 400, { error: 'Pega una función JavaScript antes de enviarla.' });
      return;
    }

    const requested =
      'representation' in parsed && typeof parsed.representation === 'string'
        ? parsed.representation
        : 'p';
    if (!REPRESENTATIONS.includes(requested as RepresentationId)) {
      sendJson(response, 400, {
        error: `Representación desconocida: ${requested}. Usa b0, b1, b2 o p.`,
      });
      return;
    }
    const representation = requested as RepresentationId;

    let provider: ProviderHandle;
    try {
      provider = createProvider();
    } catch (error) {
      sendJson(response, 503, {
        error: error instanceof Error ? error.message : String(error),
        hint: 'Completa COMMANDCODE_API_KEY, COMMANDCODE_BASE_URL y COMMANDCODE_MODEL en .env y reinicia el servidor.',
      });
      return;
    }

    try {
      const bundle = buildRepresentationBundle(source);
      const artifact = bundle.artifacts[representation];
      const generationRequest = buildGenerationRequest(artifact, probeProtocol(provider.model));
      const result = await provider.client.generate(generationRequest);

      sendJson(response, 200, {
        mode: 'ui-probe',
        representation,
        functionId: bundle.functionId,
        sourceHash: bundle.sourceHash,
        input: artifact.content,
        output: result.output,
        metadata: result.metadata,
        notice:
          'Llamada de prueba desde la interfaz. No se guarda en la caché del experimento ni cuenta como evidencia.',
      });
    } catch (error) {
      if (error instanceof FunctionNotAdmittedError) {
        sendJson(response, 422, {
          error: 'La función no pertenece al subconjunto admitido.',
          cause: error.admission.cause,
          detail: error.admission.detail,
        });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: error.message, failedStep: 'parse' });
        return;
      }
      if (error instanceof GenerationClientError) {
        sendJson(response, 502, {
          error: error.message,
          statusCode: error.statusCode,
          responseBody: error.responseBody,
        });
        return;
      }
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
