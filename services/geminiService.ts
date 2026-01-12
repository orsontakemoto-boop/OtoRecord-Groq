
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ConsultationSummary } from "../types";

export async function processConsultationAudio(audioBase64: string, mimeType: string, apiKey: string): Promise<ConsultationSummary> {
  if (!apiKey) {
    throw new Error("Chave de API não configurada.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });

  const systemInstruction = `
    Você é um assistente médico especializado em Otorrinolaringologia. 
    Analise o áudio da consulta e gere um resumo estruturado para o prontuário médico.
    O resumo deve ser conciso, profissional e usar terminologia médica adequada em português.
    
    Estruture a resposta nos seguintes campos:
    - pacienteInfo: Identificação básica se mencionada (nome, idade, etc).
    - queixaPrincipal: O motivo principal da consulta.
    - hda: História da Doença Atual (tempo de evolução, sintomas associados, fatores de melhora/piora).
    - antecedentes: Comorbidades, fatores de risco, alergias, histórico familiar e pessoal.
    - exameFisico: Achados do exame físico mencionados (otoscopia, rinoscopia, oroscopia).
    - hipoteseDiagnostica: Suspeitas diagnósticas baseadas no relato.
    - conduta: Orientações, prescrições e pedidos de exames.
  `;

  try {
    // Criação de uma promessa de Timeout para evitar loops infinitos
    const timeoutLimit = 90000; // 90 segundos (áudios longos demoram processar)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), timeoutLimit)
    );

    // Chamada da API
    const apiCall = ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: audioBase64
            }
          },
          { text: "Por favor, analise este áudio de consulta médica e extraia as informações para o prontuário estruturado." }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pacienteInfo: { type: Type.STRING },
            queixaPrincipal: { type: Type.STRING },
            hda: { type: Type.STRING },
            antecedentes: { type: Type.STRING },
            exameFisico: { type: Type.STRING },
            hipoteseDiagnostica: { type: Type.STRING },
            conduta: { type: Type.STRING }
          },
          propertyOrdering: ["pacienteInfo", "queixaPrincipal", "hda", "antecedentes", "exameFisico", "hipoteseDiagnostica", "conduta"],
        }
      }
    });

    // Promise.race vai resolver quem terminar primeiro: a API ou o Timeout
    const response = await Promise.race([apiCall, timeoutPromise]) as GenerateContentResponse;

    const resultText = response.text;
    if (!resultText) throw new Error("A IA retornou uma resposta vazia.");

    return JSON.parse(resultText) as ConsultationSummary;

  } catch (error: any) {
    console.error("Erro detalhado no Gemini:", error);

    // Tratamento de erros específicos para feedback ao usuário
    if (error.message === "TIMEOUT") {
      throw new Error("O processamento demorou muito. Verifique sua internet ou tente um áudio mais curto.");
    }

    // Verificação genérica de erros (Duck typing para evitar imports quebrados)
    const status = error.status || 0;
    const msg = error.message || JSON.stringify(error);

    if (status === 429 || msg.includes("429") || msg.includes("Quota exceeded") || msg.includes("Resource has been exhausted")) {
      throw new Error("Limite de cota da SUA chave atingido. Verifique seu plano no Google AI Studio.");
    }

    if (status === 400 || msg.includes("API_KEY_INVALID") || msg.includes("400")) {
      throw new Error("Chave de API inválida. Verifique as configurações.");
    }

    if (status === 503 || msg.includes("503") || msg.includes("overloaded")) {
      throw new Error("Serviço da IA temporariamente sobrecarregado. Tente novamente em instantes.");
    }

    throw new Error(`Falha na comunicação com a IA: ${msg.substring(0, 100)}...`);
  }
}
