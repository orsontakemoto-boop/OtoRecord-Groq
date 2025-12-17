
import { GoogleGenAI, Type } from "@google/genai";
import { ConsultationSummary } from "../types";

export async function processConsultationAudio(audioBase64: string, mimeType: string): Promise<ConsultationSummary> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    Você é um assistente médico especializado em Otorrinolaringologia. 
    Analise o áudio da consulta e gere um resumo estruturado para o prontuário médico.
    O resumo deve ser conciso, profissional e usar terminologia médica adequada em português.
    
    Estruture a resposta nos seguintes campos:
    - pacienteInfo: Identificação básica se mencionada (nome, idade, etc).
    - queixaPrincipal: O motivo principal da consulta.
    - hda: História da Doença Atual (tempo de evolução, sintomas associados, fatores de melhora/piora).
    - exameFisico: Achados do exame físico mencionados (otoscopia, rinoscopia, oroscopia).
    - hipoteseDiagnostica: Suspeitas diagnósticas baseadas no relato.
    - conduta: Orientações, prescrições e pedidos de exames.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: audioBase64
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pacienteInfo: { type: Type.STRING },
            queixaPrincipal: { type: Type.STRING },
            hda: { type: Type.STRING },
            exameFisico: { type: Type.STRING },
            hipoteseDiagnostica: { type: Type.STRING },
            conduta: { type: Type.STRING }
          },
          required: ["queixaPrincipal", "hda", "conduta"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("Não foi possível gerar o resumo.");
    
    return JSON.parse(resultText) as ConsultationSummary;
  } catch (error) {
    console.error("Erro no processamento Gemini:", error);
    throw error;
  }
}
