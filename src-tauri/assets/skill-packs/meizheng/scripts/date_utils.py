#!/usr/bin/env python3
import calendar
from datetime import datetime, timedelta


def calculate_end_date(start_date: datetime, validity_days: int) -> datetime:
    if validity_days == -1:
        year = start_date.year
        month = start_date.month
        if month == 12:
            return datetime(year + 1, 1, 1, 0, 0, 0)
        else:
            return datetime(year, month + 1, 1, 0, 0, 0)
    else:
        return start_date + timedelta(days=validity_days)


def is_last_day_of_month(check_date=None):
    if check_date is None:
        check_date = datetime.now().date()
    elif isinstance(check_date, datetime):
        check_date = check_date.date()
    tomorrow = check_date + timedelta(days=1)
    return tomorrow.day == 1
