import { ArrowRight, Sparkles, ShieldCheck, Globe2, ArrowDownUp, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import type { Currency } from '@/lib/blockchain';

const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io/tx';

const CURRENCY_LABELS: Record<Currency, string> = {
  XOF: 'XOF — Franc CFA',
  EUR: 'EUR — Euro',
  USD: 'USD — Dollar',
};

/** Returns human-readable rate: how many targetCurrency per 1 sourceCurrency */
function computeDisplayRate(
  sourceCurrency: Currency,
  targetCurrency: Currency,
  rates: { EUR: number; USD: number },
): number | null {
  if (sourceCurrency === targetCurrency) return null;
  // rates.EUR = XOF per 1 EUR, rates.USD = XOF per 1 USD
  const xofPerEUR = rates.EUR;
  const xofPerUSD = rates.USD;

  if (sourceCurrency === 'XOF' && targetCurrency === 'EUR') return 1 / xofPerEUR;
  if (sourceCurrency === 'XOF' && targetCurrency === 'USD') return 1 / xofPerUSD;
  if (sourceCurrency === 'EUR' && targetCurrency === 'XOF') return xofPerEUR;
  if (sourceCurrency === 'USD' && targetCurrency === 'XOF') return xofPerUSD;
  if (sourceCurrency === 'EUR' && targetCurrency === 'USD') return xofPerEUR / xofPerUSD;
  if (sourceCurrency === 'USD' && targetCurrency === 'EUR') return xofPerUSD / xofPerEUR;
  return null;
}

function getSourceBalance(
  sourceCurrency: Currency,
  xofBalance: string,
  eurBalance: string,
  usdBalance: string,
): string {
  if (sourceCurrency === 'XOF') return xofBalance;
  if (sourceCurrency === 'EUR') return eurBalance;
  return usdBalance;
}

export function TransferPanel() {
  const connectWallet   = useAppStore((s) => s.connectWallet);
  const executeTransfer = useAppStore((s) => s.executeTransfer);
  const account         = useAppStore((s) => s.account);
  const status          = useAppStore((s) => s.status);
  const xofBalance      = useAppStore((s) => s.xofBalance);
  const eurBalance      = useAppStore((s) => s.eurBalance);
  const usdBalance      = useAppStore((s) => s.usdBalance);
  const isPending       = useAppStore((s) => s.isPending);
  const lastTxHash      = useAppStore((s) => s.lastTxHash);
  const rates           = useAppStore((s) => s.rates);
  const feeBps          = useAppStore((s) => s.feeBps);

  const [amount, setAmount]               = useState('1000');
  const [recipient, setRecipient]         = useState('');
  const [sourceCurrency, setSourceCurrency] = useState<Currency>('XOF');
  const [targetCurrency, setTargetCurrency] = useState<Currency>('EUR');
  const [error, setError]                 = useState('');

  const isSamePair = sourceCurrency === targetCurrency;
  const displayRate = computeDisplayRate(sourceCurrency, targetCurrency, rates);
  const sourceBalance = getSourceBalance(sourceCurrency, xofBalance, eurBalance, usdBalance);

  const grossEstimate = displayRate && amount ? Number(amount) * displayRate : null;
  const netEstimate   = grossEstimate !== null ? grossEstimate * (1 - feeBps / 10_000) : null;
  const feeEstimate   = grossEstimate !== null ? grossEstimate * (feeBps / 10_000) : null;

  const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  const handleSwap = () => {
    setSourceCurrency(targetCurrency);
    setTargetCurrency(sourceCurrency);
  };

  const handleSourceChange = (val: Currency) => {
    setSourceCurrency(val);
    if (val === targetCurrency) {
      // pick a different target automatically
      const others: Currency[] = (['XOF', 'EUR', 'USD'] as Currency[]).filter((c) => c !== val);
      setTargetCurrency(others[0]);
    }
  };

  const handleTargetChange = (val: Currency) => {
    setTargetCurrency(val);
    if (val === sourceCurrency) {
      const others: Currency[] = (['XOF', 'EUR', 'USD'] as Currency[]).filter((c) => c !== val);
      setSourceCurrency(others[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    if (isSamePair) return;
    if (!account) { setError("Connectez d'abord votre portefeuille"); return; }
    if (!recipient.match(/^0x[0-9a-fA-F]{40}$/)) {
      setError('Adresse destinataire invalide (format 0x...)');
      return;
    }
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) { setError('Montant invalide'); return; }
    if (Number(sourceBalance) < numAmount) {
      setError(`Solde ${sourceCurrency} insuffisant (disponible : ${Number(sourceBalance).toLocaleString('fr-FR')})`);
      return;
    }
    try {
      await executeTransfer({ amount, recipient, sourceCurrency, targetCurrency });
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  };

  return (
    <Card className="transfer-panel">
      <div className="transfer-panel__header">
        <div>
          <p className="eyebrow">Panneau de transfert</p>
          <h3>Envoi stablecoin</h3>
        </div>
        <div className="transfer-panel__badge">
          <Sparkles size={14} />
          <span>{sourceCurrency} → {targetCurrency}</span>
        </div>
      </div>

      <div className="transfer-panel__wallet">
        <div>
          <span>Portefeuille</span>
          <strong>{account || 'Non connecté'}</strong>
          {account && (
            <span style={{ fontSize: '0.75rem', color: '#00e5ff', display: 'block', marginTop: '2px' }}>
              Solde {sourceCurrency} : {Number(sourceBalance).toLocaleString('fr-FR', { maximumFractionDigits: 4 })} {sourceCurrency}
            </span>
          )}
        </div>
        <Button variant="ghost" type="button" onClick={connectWallet} disabled={isPending}>
          {account ? 'Reconnecter' : 'Connecter MetaMask'}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="transfer-form">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.75rem', alignItems: 'end' }}>
          <label>
            De
            <select
              value={sourceCurrency}
              onChange={(e) => handleSourceChange(e.target.value as Currency)}
              disabled={isPending}
            >
              {(Object.keys(CURRENCY_LABELS) as Currency[]).map((c) => (
                <option key={c} value={c}>{CURRENCY_LABELS[c]}</option>
              ))}
            </select>
          </label>

          <Button
            type="button" variant="ghost" onClick={handleSwap} disabled={isPending}
            style={{ padding: '0.85rem', marginBottom: '2px', borderRadius: '0.75rem' }}
            aria-label="Inverser les devises"
          >
            <ArrowDownUp size={16} />
          </Button>

          <label>
            Vers
            <select
              value={targetCurrency}
              onChange={(e) => handleTargetChange(e.target.value as Currency)}
              disabled={isPending}
            >
              {(Object.keys(CURRENCY_LABELS) as Currency[]).map((c) => (
                <option key={c} value={c} disabled={c === sourceCurrency}>
                  {CURRENCY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Montant {sourceCurrency}
          <input
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Ex : 1000"
            disabled={isPending}
          />
        </label>

        <label>
          Adresse du destinataire
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
            disabled={isPending}
          />
        </label>

        <div className="transfer-panel__rates">
          {displayRate ? (
            <>
              <div>
                <span>Taux marché</span>
                <strong>1 {sourceCurrency} ≈ {displayRate.toFixed(6)} {targetCurrency}</strong>
              </div>
              <div>
                <span>Vous recevez ({feeBps / 100}% frais déduits)</span>
                <strong style={{ color: '#00e5ff' }}>
                  {netEstimate !== null ? fmt(netEstimate) : '—'} {targetCurrency}
                </strong>
              </div>
              {feeEstimate !== null && feeEstimate > 0 && (
                <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: '#888', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
                  Frais de service : {fmt(feeEstimate)} {targetCurrency} ({feeBps / 100}%)
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#ff6b6b', fontSize: '0.85rem' }}>
              Sélectionnez deux devises différentes
            </div>
          )}
        </div>

        {error && (
          <div style={{ color: '#ff6b6b', fontSize: '0.85rem', padding: '0.5rem 0' }}>
            {error}
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={isSamePair || isPending}
        >
          {isPending ? (
            <>
              <Loader2 size={16} className="mr-2" style={{ animation: 'spin 1s linear infinite' }} />
              Transaction en cours…
            </>
          ) : (
            <>
              Envoyer sur Sepolia
              <ArrowRight size={16} className="ml-2" />
            </>
          )}
        </Button>
      </form>

      <div className="transfer-panel__footer">
        <div>
          <ShieldCheck size={16} />
          <span>Sepolia testnet — contrat vérifié</span>
        </div>
        <div>
          <Globe2 size={16} />
          <span>{status}</span>
        </div>
        {lastTxHash && (
          <div style={{ gridColumn: '1 / -1' }}>
            <a
              href={`${SEPOLIA_EXPLORER}/${lastTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#00e5ff', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <ExternalLink size={12} />
              Voir le dernier tx sur Etherscan
            </a>
          </div>
        )}
      </div>
    </Card>
  );
}
