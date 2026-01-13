
import React, { useEffect, useRef, useState } from 'react';

interface VuMeterProps {
    analyser: AnalyserNode | null;
    className?: string;
    isPaused?: boolean;
}

const VuMeter: React.FC<VuMeterProps> = ({ analyser, className = '', isPaused = false }) => {
    // Quantidade de "LEDs" na barra
    const LED_COUNT = 24;
    const [volumeLevel, setVolumeLevel] = useState(0); // 0 a 100
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        if (!analyser || isPaused) {
            setVolumeLevel(0);
            return;
        }

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateMeter = () => {
            // Obtém dados de frequência atuais
            analyser.getByteFrequencyData(dataArray);

            // Calcula volume médio (RMS aproximado)
            let sum = 0;
            // Pegamos apenas uma faixa de frequências relevante para voz (evita ruído de fundo muito baixo ou muito alto)
            // Ajuste empírico: range 0-100 costuma pegar bem a fundamental da voz
            const lengthToAnalyze = Math.min(dataArray.length, 128);
            for (let i = 0; i < lengthToAnalyze; i++) {
                sum += dataArray[i];
            }

            const average = sum / lengthToAnalyze;

            // Normaliza para 0-100 (ajustando sensibilidade)
            // 255 é o max, mas voz normal raramente passa de 150-180 direto
            const sensitivity = 1.5;
            let level = (average / 128) * 100 * sensitivity;

            if (level > 100) level = 100;
            if (level < 0) level = 0;

            // Suavização (Decay) para não ficar piscando freneticamente
            setVolumeLevel(prev => {
                if (level > prev) return level; // Subida rápida
                return prev - 2; // Queda mais lenta
            });

            rafRef.current = requestAnimationFrame(updateMeter);
        };

        updateMeter();

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [analyser, isPaused]);

    // Função para determinar cor do LED baseada no índice e se está 'aceso'
    const getLedColor = (index: number, isOn: boolean) => {
        const percentage = (index / LED_COUNT) * 100;

        // Cor base (Aceso)
        let colorClass = 'bg-green-500';
        if (percentage > 60) colorClass = 'bg-yellow-400';
        if (percentage > 85) colorClass = 'bg-red-500';

        // Se estiver apagado, retorna cor 'desligada' (com opacidade ou cor escura)
        if (!isOn) return 'bg-slate-200'; // ou bg-slate-800 para dark mode

        return colorClass + ' shadow-[0_0_8px_rgba(0,0,0,0.3)]'; // Efeito neon leve
    };

    return (
        <div className={`p-4 bg-slate-900 rounded-lg shadow-inner border border-slate-700 w-full max-w-sm mx-auto ${className}`}>
            <div className="flex justify-between gap-1 h-6">
                {Array.from({ length: LED_COUNT }).map((_, i) => {
                    // Cada LED representa uma fatia do volume total
                    const threshold = (i / LED_COUNT) * 100;
                    const isOn = volumeLevel > threshold;

                    return (
                        <div
                            key={i}
                            className={`flex-1 rounded-sm transition-colors duration-75 ${getLedColor(i, isOn)}`}
                        ></div>
                    );
                })}
            </div>
            <div className="flex justify-between mt-1 px-1">
                <span className="text-[10px] text-slate-500 font-mono font-bold">-60dB</span>
                <span className="text-[10px] text-slate-500 font-mono font-bold">-20dB</span>
                <span className="text-[10px] text-slate-500 font-mono font-bold text-red-500">Peak</span>
            </div>
        </div>
    );
};

export default VuMeter;
