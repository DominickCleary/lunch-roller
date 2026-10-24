import { expect, it } from 'vitest'
import { approximateOdds, weightInput } from './odds'

it('shows simple approximate odds instead of awkward high-denominator fractions', () => {
	expect(approximateOdds(57 / 812)).toBe('≈ 13/1')
	expect(approximateOdds(1 / 3)).toBe('2/1')
	expect(approximateOdds(0.4)).toBe('3/2')
	expect(approximateOdds(1 / 1.8)).toBe('4/5')
	expect(approximateOdds(0.5)).toBe('1/1')
	expect(approximateOdds(1)).toBe('0/1')
	expect(approximateOdds(0)).toBe('—')
	expect(approximateOdds(0.00001)).toMatch(/k\/1/i)
})
it('formats stored weights without presenting underflow as an editable zero', () => {
	expect(weightInput(Math.log(0.001))).toBe('0.001')
	expect(weightInput(-10000)).toBe('')
	expect(weightInput(10000)).toBe('')
})
