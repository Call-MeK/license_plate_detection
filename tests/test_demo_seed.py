from sqlalchemy import func, select


def test_demo_seed_is_repeatable_and_keeps_existing_prices(db):
    from app.database import seed_demo
    from app.models import PricingPolicy, StolenVehicle
    db.add(PricingPolicy(vehicle_type="CAR", version=1, hourly_rate=7000, rounding_minutes=60))
    db.commit()
    seed_demo(db)
    db.commit()
    seed_demo(db)
    db.commit()
    assert db.scalar(select(func.count()).select_from(PricingPolicy)) == 2
    assert db.scalar(select(func.count()).select_from(StolenVehicle)) == 1
    car = db.scalar(select(PricingPolicy).where(PricingPolicy.vehicle_type == "CAR"))
    assert int(car.hourly_rate) == 7000
