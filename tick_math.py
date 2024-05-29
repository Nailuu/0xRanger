import sys
import math

# tick = int(sys.argv[1])
# percent_range = float(sys.argv[2])

# def getPriceByTick(tick):
#         price = math.pow(1.0001, tick)
#         decimals0 = 1e18
#         decimals1 = 1e6
#         price = price * decimals0 / decimals1
#         return price

# def getNearestInitializedTick(tick, tickSpacing):
#         tick = round(tick)
#         if (tick % tickSpacing > 5):
#                 return tick + (tickSpacing - tick % tickSpacing)
#         else:
#                 return tick - (tick % tickSpacing)
        
# def getTickForPrice(price):
#         return math.log(price, 1.0001)
        
# def main():
#         price = getPriceByTick(tick)
#         print(price)
#         _tick = getTickForPrice(price)
#         print(_tick)
#         print(getPriceByTick(_tick))
#         # tick0 = getNearestInitializedTick(tick * (1 - percent_range / 100), 10)
#         # tick1 = getNearestInitializedTick(tick * (1 + percent_range / 100), 10)
#         # print("current tick: ", tick)
#         # print("tick0: ", tick0)
#         # print("tick1: ", tick1)

def price_to_tick(p):
    return math.floor(math.log(p, 1.0001))

q96 = 2**96
def price_to_sqrtp(p):
    return int(math.sqrt(p) * q96)

price = float(sys.argv[1])
lprice = price * (1 - 2.5 / 100)
uprice = price * (1 + 2.5 / 100)
print(lprice, uprice)

sqrtp_low = price_to_sqrtp(lprice)
sqrtp_cur = price_to_sqrtp(price)
sqrtp_upp = price_to_sqrtp(uprice)

def liquidity0(amount, pa, pb):
    if pa > pb:
        pa, pb = pb, pa
    return (amount * (pa * pb) / q96) / (pb - pa)

def liquidity1(amount, pa, pb):
    if pa > pb:
        pa, pb = pb, pa
    return amount * q96 / (pb - pa)

amount_eth = 1 * 1e18


liq = amount_eth

def calc_amount0(liq, pa, pb):
    if pa > pb:
        pa, pb = pb, pa
    return int(liq * q96 * (pb - pa) / pa / pb)


def calc_amount1(liq, pa, pb):
    if pa > pb:
        pa, pb = pb, pa
    return int(liq * (pb - pa) / q96)

amount0 = calc_amount0(liq, sqrtp_upp, sqrtp_cur)
amount1 = calc_amount1(liq, sqrtp_low, sqrtp_cur)

print(amount0 / 1e18, amount1 / 1e18)

# price0 = 3394.7865
# curr_price = 3880.32
# price1 = 4363.2982

# _range = price0 + price1

# low_tick = price_to_tick(price0)
# curr_tick = price_to_tick(curr_price)
# upp_tick = price_to_tick(price1)

# def diff(x, y):
#     return ((x - y) / y) * 100

# range_tick = upp_tick + low_tick
# amount0 = 2382.25
# amount1 = 2703.88
# _range2 = amount0 + amount1

# print("lower tick: ", low_tick, " - diff: ", (low_tick / range_tick * 100), " - diff2: ", (amount0 / _range2 * 100), " - diff3: ", diff(price0, curr_price))
# print("curr tick: ", curr_tick)
# print("upper tick: ", upp_tick, " - diff: ", (upp_tick / range_tick * 100), " - diff2: ", (amount1 / _range2 * 100), " - diff3: ", diff(price1, curr_price))

# main()
# print(getPriceByTick(tick))


# price = 3889.36
# lower_price = price * (1 - 2.5 / 100)
# upper_price = price * (1 + 2.5 / 100)

# curr_tick = price_to_tick(price)
# lower_tick = price_to_tick(lower_price)
# upper_tick = price_to_tick(upper_price)

# # upper_tick = getNearestInitializedTick(upper_tick, 10)
# print(diff(lower_price, price), diff(upper_price, price))
# print(lower_tick, upper_tick)

# print(diff(3793.2961, price), diff(3987.7726, price))
# print(diff(lower_tick, curr_tick), diff(upper_tick, curr_tick))
# print((lower_tick / (lower_tick + upper_tick)) * 100, (upper_tick / (lower_tick + upper_tick)) * 100)

# print("low: ", lower_price, " - high: ", upper_price)