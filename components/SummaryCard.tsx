
import React from 'react';
import { ConsultationSummary } from '../types';

interface SummaryCardProps {
  summary: ConsultationSummary;
  onReset: () => void;
  onCopy: () => void;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ summary, onReset, onCopy }) => {
  const sections = [
    { label: 'Identificação', value: summary.pacienteInfo, icon: 'fa-user' },
    { label: 'Queixa Principal', value: summary.queixaPrincipal, icon: 'fa-comment-medical' },
    { label: 'HDA', value: summary.hda, icon: 'fa-history' },
    { label: 'Antecedentes', value: summary.antecedentes, icon: 'fa-notes-medical' },
    { label: 'Exame Físico', value: summary.exameFisico, icon: 'fa-stethoscope' },
    { label: 'Hipótese Diagnóstica', value: summary.hipoteseDiagnostica, icon: 'fa-lightbulb' },
    { label: 'Conduta', value: summary.conduta, icon: 'fa-file-medical' },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100 max-w-4xl mx-auto animate-fadeIn">
      <div className="bg-blue-600 px-6 py-4 flex justify-between items-center">
        <h2 className="text-white font-bold text-lg flex items-center gap-2">
          <i className="fas fa-file-alt"></i> Resumo da Anamnese
        </h2>
        <div className="flex gap-2">
          <button
            onClick={onCopy}
            className="bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-sm transition-all flex items-center gap-2"
          >
            <i className="fas fa-copy"></i> Copiar
          </button>
          <button
            onClick={onReset}
            className="bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-sm transition-all flex items-center gap-2"
          >
            <i className="fas fa-redo"></i> Novo
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {sections.map((section, idx) => (
          <div key={idx} className="border-b border-slate-50 last:border-0 pb-4 last:pb-0">
            <h3 className="text-blue-600 font-semibold text-sm uppercase tracking-wider mb-2 flex items-center gap-2">
              <i className={`fas ${section.icon} w-5`}></i> {section.label}
            </h3>
            <p className="text-slate-700 leading-relaxed">
              {section.value || <span className="text-slate-400 italic">Informação não fornecida</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-slate-50 p-4 text-center">
        <p className="text-xs text-slate-500">
          Gerado automaticamente via IA OtoRecord. Revise as informações antes de anexar ao prontuário oficial.
        </p>
      </div>
    </div>
  );
};

export default SummaryCard;
