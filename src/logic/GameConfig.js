module.exports = {
  resources: {
    foodPerPlayerMax: 6,
    waterPerPlayerMax: 6,
    medicinePerPlayerMax: 2,
    electricityBaseMax: 50,
    electricityPerCapacity: 4,
    startingRatio: 0.9,
    foodPerPlayerRound: 0.65,
    waterPerPlayerRound: 0.6,
    electricityPerRound: 4,
    medicinePerTreatment: 1,
    criticalThreshold: 0.2,
    professionProduction: {
      farmerFood: 1,
      guardWater: 1,
      engineerElectricity: 1,
      doctorMedicine: 1,
    },
  },
  events: { enabled: true, severityScale: 1, maxSeverity: 3 },
  traitor: {
    maxActions: 2,
    cooldownRounds: 1,
    actions: {
      sabotageElectricity: 1,
      contaminateWater: 1,
      destroyFood: 1,
      sabotageEquipment: 1,
    },
  },
  relations: { allianceDurationRounds: 1, trustMin: -3, trustMax: 3 },
  states: { maxSeverity: 4 },
};
