"""
Strategies Package

All trading strategies are defined here. Each strategy implements
the base Strategy class and provides generate_signals() method.
"""

from .base import Strategy
from .momentum import MomentumStrategy, AggressiveMomentum, ConservativeMomentum
from .canslim import CANSLIMStrategy, CANSLIMLite

__all__ = [
    'Strategy',
    'MomentumStrategy',
    'AggressiveMomentum',
    'ConservativeMomentum',
    'CANSLIMStrategy',
    'CANSLIMLite',
]
