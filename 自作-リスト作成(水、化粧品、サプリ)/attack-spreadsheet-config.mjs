/** アタックリスト用ブック（メイン SPREADSHEET_ID とは別） */
export const ATTACK_SPREADSHEET_ID = '1E-Pp_GqUyGQlglH6e7uEEgA-wNAtdHWo9vMd28VQ8Lg';

/** ブック内シート（google の gid = sheetId） */
export const ATTACK_SHEET_ID = Object.freeze({
  /** 1.TVショッピング */
  TV: 108276106,
  /** 2.自社通販 */
  OWN: 791874006,
  /** 3.Yahoo */
  YAHOO: 0,
  /** 4.Rakutenn */
  RAKUTEN: 1145897793,
});

/**
 * メイン収集ブック → アタックリストのコピー経路（同名タブ同士のみ）。
 * TV→TV・自社→自社・Yahoo→Yahoo・楽天→楽天以外は実装しない。
 */
export const ATTACK_LIST_COPY_ROUTES = Object.freeze({
  tv: Object.freeze({
    mainSheetTitle: '1.TVショッピング',
    attackSheetId: ATTACK_SHEET_ID.TV,
    expectedAttackSheetTitle: '1.TVショッピング',
    /** null = メインシートの全データ行を対象 */
    maxSourceDataRows: null,
    /** B列（ブランド名キー）一致のアタック行をメインの A:E で上書き（メアド列の反映など） */
    updateExistingRowsByBrandKey: true,
  }),
  own: Object.freeze({
    mainSheetTitle: '2.自社通販',
    attackSheetId: ATTACK_SHEET_ID.OWN,
    expectedAttackSheetTitle: '2.自社通販',
    maxSourceDataRows: null,
    /** B列（ブランド名キー）一致のアタック行をメインの A:D で上書き（リンク修正の反映） */
    updateExistingRowsByBrandKey: true,
  }),
  yahoo: Object.freeze({
    mainSheetTitle: '3.Yahoo',
    attackSheetId: ATTACK_SHEET_ID.YAHOO,
    expectedAttackSheetTitle: '3.Yahoo',
    maxSourceDataRows: null,
  }),
  rakuten: Object.freeze({
    mainSheetTitle: '4.Rakutenn',
    attackSheetId: ATTACK_SHEET_ID.RAKUTEN,
    expectedAttackSheetTitle: '4.Rakutenn',
    maxSourceDataRows: null,
  }),
});
