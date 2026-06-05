export class PriceSyncService {
  calculateSuggestedPrice(input: { cost: number; operationalExpense: number; marketplaceFee: number; commission: number; freight: number; desiredProfit: number }) {
    return input.cost + input.operationalExpense + input.marketplaceFee + input.commission + input.freight + input.desiredProfit;
  }
}
