'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class QuizAttempt extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  QuizAttempt.init({
    userId: DataTypes.INTEGER,
    chapterId: DataTypes.INTEGER,
    score: DataTypes.INTEGER,
    total: DataTypes.INTEGER,
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  }, {
    sequelize,
    modelName: 'QuizAttempt',
  });
  return QuizAttempt;
};