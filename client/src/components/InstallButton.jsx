import { useState } from 'react';
import { Download, Share, SquarePlus } from 'lucide-react';
import { useI18n } from '../i18n';
import { useInstall } from '../lib/pwa';
import { Modal, useToast } from './ui';
import Logo from './Logo';

/** "Install app" — native prompt on Android/Windows/Mac (Chrome, Edge), instructions on iPhone/iPad. */
export default function InstallButton({ compact = false }) {
  const { t } = useI18n();
  const toast = useToast();
  const inst = useInstall();
  const [iosHelp, setIosHelp] = useState(false);
  if (inst.mode === 'installed' || inst.mode === 'none') return null;
  const onClick = async () => {
    if (inst.mode === 'ios') { setIosHelp(true); return; }
    if (await inst.install()) toast(t('installDone'));
  };
  return (
    <>
      <button type="button" className={`btn btn-gold btn-sm ${compact ? 'btn-icon' : ''}`} onClick={onClick} aria-label={t('installApp')} title={t('installApp')}>
        <Download size={16} />{!compact && t('installApp')}
      </button>
      {iosHelp && (
        <Modal size="narrow" title={t('installApp')} onClose={() => setIosHelp(false)}
          footer={<button type="button" className="btn btn-primary" onClick={() => setIosHelp(false)}>{t('close')}</button>}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBlockEnd: 12 }}><Logo size={88} /></div>
          <ol className="stack" style={{ gap: 10, paddingInlineStart: 20, margin: 0 }}>
            <li>{t('iosStep1')} <Share size={16} aria-hidden="true" style={{ verticalAlign: 'middle' }} /></li>
            <li>{t('iosStep2')} <SquarePlus size={16} aria-hidden="true" style={{ verticalAlign: 'middle' }} /></li>
            <li>{t('iosStep3')}</li>
          </ol>
        </Modal>
      )}
    </>
  );
}
