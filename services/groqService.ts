
import Groq from "groq-sdk";
import { ConsultationSummary } from "../types";

export async function processConsultationAudio(audioBase64: string, mimeType: string, apiKey: string): Promise<ConsultationSummary> {
    if (!apiKey) {
        throw new Error("Chave de API da Groq não configurada.");
    }

    const groq = new Groq({ apiKey: apiKey, dangerouslyAllowBrowser: true });

    // 1. Converter Base64 para File (necessário para o endpoint de transcrição)
    const fetchResponse = await fetch(`data:${mimeType};base64,${audioBase64}`);
    const blob = await fetchResponse.blob();
    const file = new File([blob], "recording.webm", { type: mimeType });

    try {
        // ETAPA 1: Transcrição (Whisper)
        console.log("Iniciando transcrição com Whisper...");
        const transcription = await groq.audio.transcriptions.create({
            file: file,
            model: "whisper-large-v3", // Modelo multilingue necessário para pt
            response_format: "json",
            language: "pt", // Forçar português ajuda na precisão
            temperature: 0.0,
        });

        const transcribedText = transcription.text;
        console.log("Transcrição concluída:", transcribedText.substring(0, 50) + "...");

        if (!transcribedText || transcribedText.length < 5) {
            throw new Error("Não foi possível transcrever o áudio com clareza.");
        }

        // ETAPA 2: Estruturação (Llama 3)
        console.log("Iniciando estruturação com Llama 3...");

      Você é um assistente médico especialista em Otorrinolaringologia.
      Sua tarefa é analisar a transcrição da consulta e gerar um prontuário médico de alta qualidade, usando terminologia técnica formal e detalhada.

      DIRETRIZES OBRIGATÓRIAS:
        1. ** Terminologia Técnica **: Converta termos leigos para técnicos(ex: use "odinofagia" vez de "dor de garganta", "hipoacusia" em vez de "surdez", "epistaxe" em vez de "sangramento").
      2. ** Detalhamento **: Não resuma excessivamente.Mantenha todos os detalhes clínicos, cronologia e descrições fornecidas.
      3. ** Exame Físico **: Se mencionado, descreva com precisão técnica(otoscopia, rinoscopia, oroscopia).
      4. ** Estilo **: Use linguagem culta, impessoal e direta, padrão de prontuário médico.

      Estrutura do JSON:
            {
                "pacienteInfo": "Identificação (Nome, Idade) se citado (string)",
                    "queixaPrincipal": "Motivo principal com termo técnico (string)",
                        "hda": "História completa e detalhada da moléstia atual (string)",
                            "antecedentes": "Histórico mórbido, alergias, medicações em uso (string)",
                                "exameFisico": "Descrição técnica dos achados (string)",
                                    "hipoteseDiagnostica": "Hipóteses diagnósticas prováveis (string)",
                                        "conduta": "Plano terapêutico detalhado, exames solicitados e orientações (string)"
            }
      
      Se alguma informação não estiver presente, use "Não relatado".
      Responda APENAS o JSON, sem markdown.

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Transcrição da consulta:\n\n${transcribedText}` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const jsonResponse = completion.choices[0]?.message?.content;

        if (!jsonResponse) {
            throw new Error("A IA não retornou o JSON esperado.");
        }

        return JSON.parse(jsonResponse) as ConsultationSummary;

    } catch (error: any) {
        console.error("Erro no serviço Groq:", error);

        if (error.status === 401) {
            throw new Error("Erro 401: Chave de API Groq inválida.");
        }

        throw new Error(`Erro no processamento: ${error.message || 'Falha desconhecida'}`);
    }
}
