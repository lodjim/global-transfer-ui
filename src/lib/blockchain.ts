import { BrowserProvider, Contract, parseUnits, formatUnits } from 'ethers';
import {
  CONTRACT_ADDRESSES,
  TOKEN_ADDRESS,
  TRANSFER_MANAGER_ABI,
  RATE_ORACLE_ABI,
  ERC20_ABI,
  SEPOLIA_CHAIN_ID,
} from '@/config/contracts';
import type { Transaction } from '@/store/useAppStore';

function getProvider(): BrowserProvider {
  if (!window.ethereum) throw new Error('MetaMask non détecté');
  return new BrowserProvider(window.ethereum);
}

async function getSigner() {
  const provider = getProvider();
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
    throw new Error('Veuillez basculer MetaMask sur le réseau Sepolia');
  }
  return provider.getSigner();
}

export async function getTokenBalance(tokenAddress: string, account: string): Promise<string> {
  const provider = getProvider();
  const token = new Contract(tokenAddress, ERC20_ABI, provider);
  const raw: bigint = await token.balanceOf(account);
  return formatUnits(raw, 18);
}

export async function getXOFBalance(account: string): Promise<string> {
  return getTokenBalance(CONTRACT_ADDRESSES.XOFToken, account);
}

export async function getLiveRate(targetCurrency: 'EUR' | 'USD'): Promise<number> {
  const provider = getProvider();
  const oracle = new Contract(CONTRACT_ADDRESSES.RateOracle, RATE_ORACLE_ABI, provider);
  const raw: bigint = await oracle.getRate(TOKEN_ADDRESS[targetCurrency]);
  // raw = XOF_per_1_target * 1e18  (e.g. 655.957e18 for EUR)
  return Number(formatUnits(raw, 18));
}

export async function getLiveFeeBps(): Promise<number> {
  const provider = getProvider();
  const manager = new Contract(CONTRACT_ADDRESSES.TransferManager, TRANSFER_MANAGER_ABI, provider);
  const raw: bigint = await manager.feeBps();
  return Number(raw);
}

export type Currency = 'XOF' | 'EUR' | 'USD';

export async function executeSwap(
  recipient: string,
  amountSource: string,
  sourceCurrency: Currency,
  targetCurrency: Currency,
): Promise<string> {
  const signer = await getSigner();
  const manager = new Contract(CONTRACT_ADDRESSES.TransferManager, TRANSFER_MANAGER_ABI, signer);
  const amountWei = parseUnits(amountSource, 18);
  const tx = await manager.swap(
    recipient,
    TOKEN_ADDRESS[sourceCurrency],
    amountWei,
    TOKEN_ADDRESS[targetCurrency],
  );
  const receipt = await tx.wait();
  return receipt.hash as string;
}

function addrToCurrency(addr: string): Currency {
  const a = addr.toLowerCase();
  if (a === TOKEN_ADDRESS.EUR.toLowerCase()) return 'EUR';
  if (a === TOKEN_ADDRESS.USD.toLowerCase()) return 'USD';
  return 'XOF';
}

export async function fetchTransferHistory(account: string): Promise<Transaction[]> {
  const provider = getProvider();
  const manager = new Contract(CONTRACT_ADDRESSES.TransferManager, TRANSFER_MANAGER_ABI, provider);

  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 50_000);

  // Query swaps sent by account and swaps received by account
  const [sentEvents, receivedEvents] = await Promise.all([
    manager.queryFilter(manager.filters.SwapCompleted(account, null, null), fromBlock),
    manager.queryFilter(manager.filters.SwapCompleted(null, account, null), fromBlock),
  ]);

  const blockCache = new Map<number, number>();
  async function getTimestamp(blockNumber: number): Promise<number> {
    if (blockCache.has(blockNumber)) return blockCache.get(blockNumber)!;
    const block = await provider.getBlock(blockNumber);
    const ts = block?.timestamp ?? Math.floor(Date.now() / 1000);
    blockCache.set(blockNumber, ts);
    return ts;
  }

  function toDate(ts: number) {
    return new Date(ts * 1000).toLocaleString('fr-FR', {
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  }

  type SwapArgs = {
    sender: string; recipient: string;
    sourceToken: string; amountSource: bigint;
    targetToken: string; amountTarget: bigint;
  };

  const sent: Transaction[] = await Promise.all(
    sentEvents.map(async (ev) => {
      const ts = await getTimestamp(ev.blockNumber);
      const { amountSource, sourceToken, targetToken, recipient } = (ev as unknown as { args: SwapArgs }).args;
      return {
        id: ev.transactionHash,
        amount: Number(formatUnits(amountSource, 18)).toFixed(4),
        recipient,
        sourceCurrency: addrToCurrency(sourceToken),
        targetCurrency: addrToCurrency(targetToken),
        rate: 0,
        status: 'Envoyé',
        date: toDate(ts),
        txHash: ev.transactionHash,
      } satisfies Transaction;
    }),
  );

  // De-duplicate: if sender == recipient (self-swap), avoid showing twice
  const sentHashes = new Set(sentEvents.map((e) => e.transactionHash));
  const received: Transaction[] = await Promise.all(
    receivedEvents
      .filter((ev) => !sentHashes.has(ev.transactionHash))
      .map(async (ev) => {
        const ts = await getTimestamp(ev.blockNumber);
        const { amountTarget, sourceToken, targetToken } = (ev as unknown as { args: SwapArgs }).args;
        return {
          id: `recv-${ev.transactionHash}`,
          amount: Number(formatUnits(amountTarget, 18)).toFixed(4),
          recipient: account,
          sourceCurrency: addrToCurrency(sourceToken),
          targetCurrency: addrToCurrency(targetToken),
          rate: 0,
          status: 'Reçu',
          date: toDate(ts),
          txHash: ev.transactionHash,
        } satisfies Transaction;
      }),
  );

  return [...sent, ...received].sort((a, b) => b.date.localeCompare(a.date));
}
